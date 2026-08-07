const securityHeaders = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      ...securityHeaders,
      "Cache-Control": "no-store",
    },
  });
}

function safeBookKey(rawKey: string | null): string | null {
  if (!rawKey) return null;
  const key = rawKey;
  if (key.length > 320 || key.includes("\\") || key.includes("..")) return null;
  return /^ebookfiles\/\d+\/[^/]+\.(?:epub|pdf)$/iu.test(key) ? key : null;
}

function downloadName(key: string): string {
  const name = key.slice(key.lastIndexOf("/") + 1);
  return name.replace(/[\r\n"]/gu, "");
}

async function serveBook(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed", message: "仅支持读取电子书。" }, 405);
  }

  const key = safeBookKey(url.searchParams.get("key"));
  if (!key) {
    return json({ error: "invalid_book", message: "电子书地址无效。" }, 400);
  }

  let body: ReadableStream | null = null;
  let object: R2Object | null;
  if (request.method === "HEAD") {
    object = await env.BOOKS.head(key);
  } else {
    const storedBook = await env.BOOKS.get(key, { range: request.headers });
    object = storedBook;
    body = storedBook?.body ?? null;
  }

  if (!object) return json({ error: "not_found", message: "这本书尚未同步到云端书库。" }, 404);

  const headers = new Headers(securityHeaders);
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800");
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(downloadName(key))}`);

  let status = 200;
  if ("range" in object && object.range) {
    const offset = "offset" in object.range && object.range.offset ? object.range.offset : 0;
    const length = "length" in object.range && object.range.length
      ? object.range.length
      : object.size - offset;
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
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "文硕阁", domain: "www.wenshuoge.com" });
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
