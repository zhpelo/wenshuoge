const securityHeaders = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const DOWNLOAD_WINDOW_SECONDS = 10 * 60;
const DOWNLOAD_TICKET_SECONDS = 5 * 60;
const MAX_DOWNLOAD_ATTEMPTS_PER_WINDOW = 8;
const MAX_DISTINCT_BOOKS_PER_WINDOW = 5;
const MAX_DOWNLOAD_ATTEMPTS_PER_DAY = 25;

type DownloadTicket = {
  book_key: string;
  book_id: number;
  format: "epub" | "pdf";
  expires_at: number;
  used_at: number | null;
  purpose: "read" | "download";
};

type DownloadRate = {
  recent_attempts: number;
  recent_books: number;
  daily_attempts: number;
};

type DownloadTotal = {
  format: "epub" | "pdf";
  count: number;
};

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers({
    ...securityHeaders,
    "Cache-Control": "no-store",
  });
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, name) => headers.set(name, value));
  }
  return Response.json(data, { status, headers });
}

function safeBookKey(rawKey: string | null): string | null {
  if (!rawKey || rawKey.length > 320 || rawKey.includes("\\") || rawKey.includes("..")) return null;
  return /^ebookfiles\/\d+\/[^/]+\.(?:epub|pdf)$/iu.test(rawKey) ? rawKey : null;
}

function bookIdFromKey(key: string): number {
  return Number(key.split("/")[1]);
}

function formatFromKey(key: string): "epub" | "pdf" {
  return key.endsWith(".pdf") ? "pdf" : "epub";
}

function downloadName(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1).replace(/[\r\n"]/gu, "");
}

function storageKeys(key: string): string[] {
  const slash = key.lastIndexOf("/") + 1;
  const encoded = `${key.slice(0, slash)}${encodeURIComponent(key.slice(slash))}`;
  return encoded === key ? [key] : [key, encoded];
}

async function headStoredBook(env: Env, key: string): Promise<R2Object | null> {
  for (const candidate of storageKeys(key)) {
    const object = await env.BOOKS.head(candidate);
    if (object) return object;
  }
  return null;
}

async function getStoredBook(env: Env, key: string, request: Request): Promise<R2ObjectBody | null> {
  for (const candidate of storageKeys(key)) {
    const object = request.headers.has("Range")
      ? await env.BOOKS.get(candidate, { range: request.headers })
      : await env.BOOKS.get(candidate);
    if (object) return object;
  }
  return null;
}

function utcDay(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function visitorFingerprint(request: Request): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP") ?? "local";
  const userAgent = (request.headers.get("User-Agent") ?? "unknown").slice(0, 300);
  return sha256(`${address}\n${userAgent}`);
}

async function readSmallJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > 2048) throw new Error("payload_too_large");
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2048) throw new Error("payload_too_large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function requestIsSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function cleanupDownloadData(env: Env, now: number): Promise<void> {
  await env.METRICS.batch([
    env.METRICS.prepare("DELETE FROM download_attempts WHERE created_at < ?1").bind(now - 86400),
    env.METRICS.prepare("DELETE FROM download_tickets WHERE expires_at < ?1").bind(now - 86400),
    env.METRICS.prepare("DELETE FROM download_events WHERE created_at < ?1").bind(now - 90 * 86400),
  ]);
}

async function authorizeBookAccess(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  purpose: "read" | "download",
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed", message: "请从书籍页面发起下载。" }, 405, { Allow: "POST" });
  }
  if (!requestIsSameOrigin(request)) {
    return json({ error: "invalid_origin", message: "下载请求来源无效。" }, 403);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    return json({ error: "invalid_content_type", message: "下载请求格式无效。" }, 415);
  }

  let payload: unknown;
  try {
    payload = await readSmallJson(request);
  } catch {
    return json({ error: "invalid_payload", message: "下载请求内容无效。" }, 400);
  }

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const key = safeBookKey(typeof body.key === "string" ? body.key : null);
  const visitorId = typeof body.visitorId === "string" ? body.visitorId : "";
  if (!key || !/^[A-Za-z0-9_-]{20,80}$/u.test(visitorId)) {
    return json({ error: "invalid_book", message: "电子书或访客标识无效。" }, 400);
  }
  if (purpose === "read" && !key.endsWith(".epub")) {
    return json({ error: "reader_requires_epub", message: "在线阅读目前支持 EPUB 格式。" }, 400);
  }

  const book = await headStoredBook(env, key);
  if (!book) return json({ error: "not_found", message: "这本书尚未同步到云端书库。" }, 404);

  const now = Math.floor(Date.now() / 1000);
  const bookId = bookIdFromKey(key);
  const fingerprint = await visitorFingerprint(request);
  await env.METRICS.prepare(
    "INSERT INTO download_attempts (fingerprint, book_id, created_at) VALUES (?1, ?2, ?3)",
  ).bind(fingerprint, bookId, now).run();

  const rate = await env.METRICS.prepare(`
    SELECT
      SUM(CASE WHEN created_at >= ?2 THEN 1 ELSE 0 END) AS recent_attempts,
      COUNT(DISTINCT CASE WHEN created_at >= ?2 THEN book_id END) AS recent_books,
      COUNT(*) AS daily_attempts
    FROM download_attempts
    WHERE fingerprint = ?1 AND created_at >= ?3
  `).bind(fingerprint, now - DOWNLOAD_WINDOW_SECONDS, now - 86400).first<DownloadRate>();

  if (!rate
    || rate.recent_attempts > MAX_DOWNLOAD_ATTEMPTS_PER_WINDOW
    || rate.recent_books > MAX_DISTINCT_BOOKS_PER_WINDOW
    || rate.daily_attempts > MAX_DOWNLOAD_ATTEMPTS_PER_DAY) {
    return json({
      error: "download_rate_limited",
      message: "取阅过于频繁。请先阅读已打开的书籍，10 分钟后再试；批量抓取已被限制。",
    }, 429, { "Retry-After": String(DOWNLOAD_WINDOW_SECONDS) });
  }

  const token = crypto.randomUUID();
  const format = formatFromKey(key);
  await env.METRICS.prepare(`
    INSERT INTO download_tickets
      (token, book_key, book_id, format, fingerprint, created_at, expires_at, purpose)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(token, key, bookId, format, fingerprint, now, now + DOWNLOAD_TICKET_SECONDS, purpose).run();

  const cleanupSample = crypto.getRandomValues(new Uint8Array(1))[0];
  if (cleanupSample < 13) {
    ctx.waitUntil(cleanupDownloadData(env, now).catch((error) => {
      console.error(JSON.stringify({
        event: "download_cleanup_failed",
        message: error instanceof Error ? error.message : "unknown error",
      }));
    }));
  }
  return json({
    ok: true,
    url: `/api/book?ticket=${encodeURIComponent(token)}`,
    expiresIn: DOWNLOAD_TICKET_SECONDS,
  });
}

async function recordDownload(env: Env, token: string, now: number): Promise<void> {
  await env.METRICS.prepare(`
    INSERT OR IGNORE INTO download_events
      (fingerprint, book_id, format, event_day, created_at)
    SELECT fingerprint, book_id, format, ?2, ?3
    FROM download_tickets WHERE token = ?1
  `).bind(token, utcDay(now), now).run();
}

async function downloadStats(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed", message: "仅支持读取下载统计。" }, 405, { Allow: "GET" });
  }
  const rawBookId = url.searchParams.get("book");
  if (!rawBookId || !/^\d{1,8}$/u.test(rawBookId)) {
    return json({ error: "invalid_book", message: "书籍编号无效。" }, 400);
  }

  const rows = await env.METRICS.prepare(
    "SELECT format, count FROM download_totals WHERE book_id = ?1",
  ).bind(Number(rawBookId)).all<DownloadTotal>();
  const counts = { epub: 0, pdf: 0 };
  for (const row of rows.results) counts[row.format] = row.count;
  return json({ bookId: Number(rawBookId), ...counts, total: counts.epub + counts.pdf }, 200, {
    "Cache-Control": "public, max-age=60, s-maxage=300",
  });
}

async function serveBook(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed", message: "仅支持读取电子书。" }, 405, { Allow: "GET, HEAD" });
  }

  const token = url.searchParams.get("ticket") ?? "";
  let key: string | null = null;
  let disposition: "inline" | "attachment" = "attachment";
  let ticket: DownloadTicket | null = null;

  if (/^[0-9a-f-]{36}$/u.test(token)) {
    ticket = await env.METRICS.prepare(`
      SELECT book_key, book_id, format, expires_at, used_at, purpose
      FROM download_tickets WHERE token = ?1
    `).bind(token).first<DownloadTicket>();
    if (!ticket || ticket.expires_at < Math.floor(Date.now() / 1000)) {
      return json({ error: "expired_download", message: "下载凭证已过期，请回到书籍页面重新下载。" }, 403);
    }
    key = safeBookKey(ticket.book_key);
    disposition = ticket.purpose === "read" ? "inline" : "attachment";
  }

  if (!key) {
    return json({ error: "download_authorization_required", message: "请从书籍页面阅读或下载。" }, 403);
  }

  let body: ReadableStream | null = null;
  let object: R2Object | null;
  if (request.method === "HEAD") {
    object = await headStoredBook(env, key);
  } else {
    const storedBook = await getStoredBook(env, key, request);
    object = storedBook;
    body = storedBook?.body ?? null;
  }
  if (!object) return json({ error: "not_found", message: "这本书尚未同步到云端书库。" }, 404);

  if (ticket?.purpose === "download" && request.method === "GET" && ticket.used_at === null) {
    const now = Math.floor(Date.now() / 1000);
    const claim = await env.METRICS.prepare(
      "UPDATE download_tickets SET used_at = ?2 WHERE token = ?1 AND used_at IS NULL",
    ).bind(token, now).run();
    if ((claim.meta.changes ?? 0) === 1) {
      try {
        await recordDownload(env, token, now);
      } catch (error) {
        console.error(JSON.stringify({
          event: "download_metric_failed",
          bookId: ticket.book_id,
          message: error instanceof Error ? error.message : "unknown error",
        }));
      }
    }
  }

  const headers = new Headers(securityHeaders);
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(downloadName(key))}`);

  let status = 200;
  if (request.headers.has("Range") && "range" in object && object.range) {
    const offset = "offset" in object.range ? object.range.offset ?? 0 : 0;
    const length = "length" in object.range ? object.range.length ?? object.size - offset : object.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    status = 206;
  } else {
    headers.set("Content-Length", String(object.size));
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", key.endsWith(".pdf") ? "application/pdf" : "application/epub+zip");
  }
  return new Response(body, { status, headers });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "文硕阁", domain: "www.wenshuoge.com" });
      }
      if (url.pathname === "/api/downloads/authorize") {
        return await authorizeBookAccess(request, env, ctx, "download");
      }
      if (url.pathname === "/api/readers/authorize") {
        return await authorizeBookAccess(request, env, ctx, "read");
      }
      if (url.pathname === "/api/downloads") {
        return await downloadStats(request, env, url);
      }
      if (url.pathname === "/api/book") {
        return await serveBook(request, env, url);
      }

      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error(JSON.stringify({
        event: "request_failed",
        path: url.pathname,
        message: error instanceof Error ? error.message : "unknown error",
      }));
      return json({ error: "internal_error", message: "书库暂时无法访问，请稍后再试。" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
