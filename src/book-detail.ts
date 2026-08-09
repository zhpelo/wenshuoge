type CatalogBookRow = [
  string, string, string, string[], number, string, number, number, string, string,
];

type DetailRow = [
  string, string, string, string[], [string, string][], number, string, string,
];

type CatalogPayload = { g?: string; b: CatalogBookRow[] };
type DetailPayload = { b: Record<string, DetailRow> };

type BookDetail = {
  id: string;
  title: string;
  author: string;
  subjects: string[];
  formats: ("epub" | "pdf")[];
  paths: Partial<Record<"epub" | "pdf", string>>;
  sizes: Partial<Record<"epub" | "pdf", number>>;
  category: string;
  era: string;
  description: string;
  period: string;
  authorInfo: string;
  sources: [string, string][];
  catalogRevision: string;
};

const DETAIL_SHARD_SIZE = 500;
const SITE_ORIGIN = "https://www.wenshuoge.com";

function html(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("&", "\\u0026");
}

export function bookSlug(title: string): string {
  const slug = title.normalize("NFKC")
    .replace(/[《》「」『』【】〔〕（）()]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLocaleLowerCase("zh-CN")
    .slice(0, 80);
  return slug || "book";
}

function canonicalPath(book: Pick<BookDetail, "id" | "title">): string {
  return `/book/${encodeURIComponent(book.id)}/${encodeURIComponent(bookSlug(book.title))}`;
}

async function assetJson<T>(env: Env, origin: string, pathname: string): Promise<T> {
  const response = await env.ASSETS.fetch(new Request(new URL(pathname, origin)));
  if (!response.ok) throw new Error(`asset_${response.status}:${pathname}`);
  return response.json<T>();
}

async function findBook(env: Env, url: URL, id: string): Promise<BookDetail | null> {
  const catalog = await assetJson<CatalogPayload>(env, url.origin, "/books.json");
  const row = catalog.b.find(([bookId]) => String(bookId) === id);
  if (!row) return null;

  const [bookId, title, author, subjects, formatMask, filename, epubSize, pdfSize, category, era] = row;
  const shard = String(Math.floor(Number(bookId) / DETAIL_SHARD_SIZE)).padStart(2, "0");
  const details = await assetJson<DetailPayload>(env, url.origin, `/book-details-v2/${shard}.json`);
  const detail = details.b[bookId] ?? ["", "", "", subjects, [], 0, "", ""];
  const formats: ("epub" | "pdf")[] = [];
  const paths: BookDetail["paths"] = {};
  const sizes: BookDetail["sizes"] = {};
  if (formatMask & 1) {
    formats.push("epub");
    paths.epub = `ebookfiles/${bookId}/${filename}.epub`;
    sizes.epub = epubSize;
  }
  if (formatMask & 2) {
    formats.push("pdf");
    paths.pdf = `ebookfiles/${bookId}/${filename}.pdf`;
    sizes.pdf = pdfSize;
  }

  return {
    id: bookId,
    title,
    author,
    subjects: detail[3]?.length ? detail[3] : subjects,
    formats,
    paths,
    sizes,
    category,
    era,
    description: detail[0] || `《${title}》是文硕阁收录的中文公版电子书，可免费阅读或下载收藏。`,
    period: detail[1] || era,
    authorInfo: detail[2] || "",
    sources: detail[4] || [],
    catalogRevision: catalog.g || "unversioned",
  };
}

function formatSize(bytes = 0): string {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function renderActions(book: BookDetail): string {
  const actions: string[] = [];
  if (book.formats.includes("epub")) {
    actions.push(`<button class="read-online" type="button" data-read-online>在线阅读 EPUB</button>`);
  }
  for (const format of book.formats) {
    actions.push(`<button class="download-${format}" type="button" data-download="${format}">下载 ${format.toUpperCase()} · ${html(formatSize(book.sizes[format]))}</button>`);
  }
  return actions.join("");
}

function renderBookPage(book: BookDetail, canonicalUrl: string): string {
  const title = `《${book.title}》免费在线阅读与下载｜${book.author || "佚名"}｜文硕阁`;
  const description = book.description.replace(/\s+/gu, " ").slice(0, 155);
  const socialImage = `${SITE_ORIGIN}/images/wenshuoge-preview.jpg`;
  const tags = [...new Set([book.category, book.era, ...book.subjects])].slice(0, 10);
  const schema = {
    "@context": "https://schema.org",
    "@type": "Book",
    name: book.title,
    author: { "@type": "Person", name: book.author || "佚名" },
    description: book.description,
    genre: tags,
    url: canonicalUrl,
    inLanguage: "zh-CN",
    isAccessibleForFree: true,
    encodingFormat: book.formats.map((format) => format === "epub" ? "application/epub+zip" : "application/pdf"),
    publisher: { "@type": "Organization", name: "文硕阁", url: SITE_ORIGIN },
  };
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "文硕阁", item: `${SITE_ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: book.category, item: `${SITE_ORIGIN}/?category=${encodeURIComponent(book.category)}` },
      { "@type": "ListItem", position: 3, name: book.title, item: canonicalUrl },
    ],
  };
  const sources = book.sources.length
    ? `<section class="book-sources"><h2>资料来源</h2><div>${book.sources.map(([label, href]) => `<a href="${html(href)}" target="_blank" rel="noopener noreferrer">${html(label)}</a>`).join("")}</div></section>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#3b1f16" />
    <meta name="description" content="${html(description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <link rel="canonical" href="${html(canonicalUrl)}" />
    <meta property="og:type" content="book" />
    <meta property="og:site_name" content="文硕阁" />
    <meta property="og:locale" content="zh_CN" />
    <meta property="og:title" content="${html(title)}" />
    <meta property="og:description" content="${html(description)}" />
    <meta property="og:url" content="${html(canonicalUrl)}" />
    <meta property="og:image" content="${socialImage}" />
    <meta property="og:image:width" content="1280" />
    <meta property="og:image:height" content="720" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${html(title)}" />
    <meta name="twitter:description" content="${html(description)}" />
    <meta name="twitter:image" content="${socialImage}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css?v=6" />
    <link rel="stylesheet" href="/book-detail-v1.css?v=2" />
    <script type="application/ld+json">${safeJson(schema)}</script>
    <script type="application/ld+json">${safeJson(breadcrumbs)}</script>
    <title>${html(title)}</title>
  </head>
  <body class="book-detail-page">
    <header class="site-header book-detail-header">
      <a class="brand" href="/" aria-label="返回文硕阁首页">
        <span class="brand-seal" aria-hidden="true">文<br />硕</span>
        <span class="brand-name">文硕阁<small>WEN SHUO GE</small></span>
      </a>
      <nav aria-label="主导航">
        <a href="/#library" aria-current="page">藏书检索</a>
        <a href="/#categories">分类浏览</a>
        <a href="/authors">仰止轩</a>
        <a href="/about">关于我们</a>
      </nav>
      <a class="mobile-author-link" href="/authors">仰止轩</a>
      <span class="public-badge">公开 · 免费 · 无需登录</span>
    </header>

    <main class="book-detail-main">
      <nav class="book-breadcrumbs" aria-label="面包屑导航">
        <a href="/">文硕阁</a><span>/</span><a href="/?category=${encodeURIComponent(book.category)}">${html(book.category)}</a><span>/</span><strong>${html(book.title)}</strong>
      </nav>

      <article class="book-detail-card">
        <div class="book-detail-cover-column">
          <div class="book-object" aria-label="《${html(book.title)}》封面">
            <span class="book-pages"></span>
            <span class="book-cover">
              <span class="cover-border"></span><span class="cover-cloud cloud-a"></span><span class="cover-cloud cloud-b"></span>
              <span class="cover-title">${html(book.title)}</span><span class="cover-author">${html(book.author || "佚名")}</span><span class="cover-mark">文硕阁</span>
            </span>
          </div>
          <p>公版典籍 · 免费取阅 · 无需登录</p>
        </div>

        <div class="book-detail-content">
          <p class="eyebrow dark"><span></span>文硕阁藏书 · BOOK ${html(book.id)}</p>
          <h1>《${html(book.title)}》</h1>
          <p class="book-detail-author">著者 · ${html(book.author || "佚名")}</p>
          <div class="book-detail-facts"><span>${html(book.period)}</span><span>${html(book.category)}</span></div>
          <div class="dialog-tags">${tags.map((tag) => `<span>${html(tag)}</span>`).join("")}</div>
          ${book.authorInfo ? `<p class="book-author-intro">${html(book.authorInfo)}</p>` : ""}
          <section class="book-summary"><h2>内容提要</h2><p>${html(book.description)}</p></section>
          ${sources}
          <div class="book-detail-actions">${renderActions(book)}</div>
          <p class="dialog-download-count" aria-live="polite">正在读取下载数据……</p>
        </div>
      </article>

      <section class="book-share-panel" aria-labelledby="share-title">
        <div><p class="eyebrow dark"><span></span>SHARE A GOOD BOOK</p><h2 id="share-title">把这本好书送给朋友</h2></div>
        <div class="share-copy-preview"><p></p><a href="${html(canonicalUrl)}">${html(decodeURI(canonicalUrl))}</a></div>
        <div class="share-lead"><button class="share-native" type="button">系统分享</button><button class="share-copy" type="button">复制文案和链接</button></div>
        <p>选择平台；没有网页直发接口的平台会自动复制分享文案和链接。</p>
        <div class="share-platforms" aria-label="分享平台"></div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="footer-brand"><span class="brand-seal small">文<br />硕</span><strong>文硕阁<small>传承文明硕果</small></strong></div>
      <p>本站仅收录并分享公共版权领域作品 · 请读者自行遵守所在地法律</p>
      <nav class="footer-links" aria-label="站点信息"><a href="/about">关于我们</a><a href="/contact">联系我们</a><a href="/copyright">版权声明</a><a href="/terms">服务协议</a></nav>
      <p>© ${new Date().getUTCFullYear()} wenshuoge.com</p>
    </footer>

    <dialog class="reader-dialog" id="epub-reader">
      <div class="reader-shell">
      <header class="reader-header"><div><p>文硕阁在线阅读</p><h2 class="reader-title">正在启卷……</h2></div><div class="reader-settings">
        <button type="button" data-reader-toc="toggle" aria-controls="reader-toc" aria-expanded="false">目录</button><button type="button" data-reader-font="smaller" aria-label="缩小字号">字−</button><button type="button" data-reader-font="larger" aria-label="放大字号">字＋</button><button type="button" data-reader-theme="toggle">明暗</button><button type="button" data-reader-fullscreen aria-label="进入全屏阅读" aria-pressed="false">全屏</button><button class="reader-close" type="button" aria-label="关闭阅读器">×</button>
      </div></header>
      <div class="reader-body"><aside class="reader-toc" id="reader-toc" hidden><div class="reader-toc-heading"><strong>章节目录</strong><button type="button" data-reader-toc="close">×</button></div><nav class="reader-toc-list"><p class="reader-toc-status">正在整理目录……</p></nav></aside><div class="reader-stage" id="reader-stage"><div class="reader-loading">正在整理篇章，请稍候……</div></div></div>
      <footer class="reader-footer"><button type="button" data-reader-nav="prev">← 上一页</button><span class="reader-progress">阅读进度将在本浏览器自动保存</span><button type="button" data-reader-nav="next">下一页 →</button></footer>
      </div>
    </dialog>
    <div class="site-toast" id="site-toast" role="status" aria-live="polite" hidden></div>
    <script id="book-data" type="application/json">${safeJson(book)}</script>
    <script src="/vendor/epubjs/jszip.min.js" defer></script>
    <script src="/vendor/epubjs/epub.min.js" defer></script>
    <script src="/book-detail-v1.js?v=3" type="module"></script>
    <script>
      !function(p){"use strict";!function(t){var s=window,e=document,i=p,c="".concat("https:"===e.location.protocol?"https://":"http://","sdk.51.la/js-sdk-pro.min.js"),n=e.createElement("script"),r=e.getElementsByTagName("script")[0];n.type="text/javascript",n.setAttribute("charset","UTF-8"),n.async=!0,n.src=c,n.id="LA_COLLECT",i.d=n;var o=function(){s.LA.ids.push(i)};s.LA?s.LA.ids&&o():(s.LA=p,s.LA.ids=[],o()),r.parentNode.insertBefore(n,r)}()}({id:"K3BXpocbCBsHygtP",ck:"K3BXpocbCBsHygtP"});
    </script>
  </body>
</html>`;
}

function renderNotFound(): Response {
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="stylesheet" href="/styles.css"><title>未找到这本书｜文硕阁</title></head><body><main class="empty-state" style="min-height:70vh;display:grid;place-content:center"><span>缺</span><h1>未找到这本书</h1><p><a href="/">返回文硕阁继续寻书</a></p></main></body></html>`;
  return new Response(body, { status: 404, headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=60" } });
}

export async function redirectLegacyBook(env: Env, url: URL, id: string): Promise<Response | null> {
  if (!/^\d{1,8}$/u.test(id)) return null;
  const book = await findBook(env, url, id);
  if (!book) return null;
  return Response.redirect(new URL(canonicalPath(book), url.origin), 308);
}

export async function serveBookDetail(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const match = url.pathname.match(/^\/book\/(\d{1,8})(?:\/([^/]+))?\/?$/u);
  if (!match) return renderNotFound();
  const book = await findBook(env, url, match[1]);
  if (!book) return renderNotFound();

  let requestedSlug = "";
  try { requestedSlug = decodeURIComponent(match[2] || ""); } catch { requestedSlug = ""; }
  const canonicalSlug = bookSlug(book.title);
  const canonicalUrl = new URL(canonicalPath(book), SITE_ORIGIN).href;
  if (requestedSlug !== canonicalSlug || url.search) {
    return Response.redirect(new URL(canonicalPath(book), url.origin), 308);
  }

  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheUrl = new URL(canonicalUrl);
  cacheUrl.searchParams.set("catalog", book.catalogRevision);
  cacheUrl.searchParams.set("render", "reader-settings-2");
  const cacheKey = new Request(cacheUrl, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return request.method === "HEAD"
      ? new Response(null, { status: cached.status, headers: cached.headers })
      : cached;
  }

  const response = new Response(request.method === "HEAD" ? null : renderBookPage(book, canonicalUrl), {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
  if (request.method === "GET") ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
