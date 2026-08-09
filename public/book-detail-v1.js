const book = JSON.parse(document.querySelector("#book-data").textContent);
const canonicalUrl = document.querySelector('link[rel="canonical"]').href;
const VISITOR_KEY = "wenshuoge:visitor";
const READER_PROGRESS_PREFIX = "wenshuoge:reader:";
const READER_FONT_SIZE_KEY = "wenshuoge:reader-font-size";
const READER_FONT_STEP = 25;
const sharePlatforms = [
  ["wechat", "微信朋友圈"], ["douyin", "抖音"], ["weibo", "微博"], ["xiaohongshu", "小红书"],
  ["bilibili", "B站"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["tiktok", "TikTok"],
  ["whatsapp", "WhatsApp"], ["linkedin", "LinkedIn"], ["x", "X"], ["snapchat", "Snapchat"],
  ["discord", "Discord"], ["threads", "Threads"], ["reddit", "Reddit"], ["pinterest", "Pinterest"],
];
const palettes = [
  ["#7b2e29", "#f0d29d"], ["#31524b", "#e9d5a6"], ["#3d4f61", "#ead3a6"],
  ["#82572e", "#f2ddb4"], ["#553a5a", "#ebd1aa"], ["#294956", "#e2c996"],
  ["#765143", "#f0d8af"], ["#465b3e", "#edd7a5"],
];

const reader = { instance: null, rendition: null, lastLocation: null, fontSize: 100, dark: false, tocOpen: false };
const elements = {
  reader: document.querySelector("#epub-reader"),
  stage: document.querySelector("#reader-stage"),
  toc: document.querySelector("#reader-toc"),
  tocList: document.querySelector(".reader-toc-list"),
  toast: document.querySelector("#site-toast"),
};
let toastTimer = 0;

function showToast(message, tone = "info") {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode can reject storage */ }
}

function savedReaderFontSize() {
  const value = Number(storageGet(READER_FONT_SIZE_KEY));
  return Number.isFinite(value) && value >= 50 ? value : 100;
}

function getVisitorId() {
  let id = storageGet(VISITOR_KEY);
  if (!id || !/^[A-Za-z0-9_-]{20,80}$/u.test(id)) {
    id = crypto.randomUUID().replaceAll("-", "");
    storageSet(VISITOR_KEY, id);
  }
  return id;
}

function applyCoverPalette() {
  const hash = [...`${book.id}${book.title}`].reduce((value, char) => ((value * 31) + char.codePointAt(0)) >>> 0, 7);
  const [background, ink] = palettes[hash % palettes.length];
  const cover = document.querySelector(".book-detail-cover-column .book-object");
  cover.style.setProperty("--book-color", background);
  cover.style.setProperty("--cover-ink", ink);
}

async function startDownload(format, button) {
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = "正在准备…";
  try {
    const response = await fetch("/api/downloads/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: book.paths[format], visitorId: getVisitorId() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "暂时无法下载，请稍后再试。");
    const link = document.createElement("a");
    link.href = data.url;
    link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
    showToast(`《${book.title}》${format.toUpperCase()} 已开始下载`);
    window.setTimeout(() => loadDownloadStats(true), 1800);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "下载失败，请稍后再试。", "error");
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

async function loadDownloadStats(fresh = false) {
  const node = document.querySelector(".dialog-download-count");
  try {
    const response = await fetch(`/api/downloads?book=${encodeURIComponent(book.id)}`, fresh ? { cache: "no-store" } : undefined);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    node.textContent = `已下载 ${data.total.toLocaleString("zh-CN")} 次 · EPUB ${data.epub.toLocaleString("zh-CN")} · PDF ${data.pdf.toLocaleString("zh-CN")}`;
  } catch { node.textContent = "下载数据暂时不可用"; }
}

function shareMessage() {
  const benefit = book.formats.includes("epub") ? "可以免费在线阅读，也能下载收藏" : "可以免费下载收藏";
  return `我送给你一本好书《${book.title}》，${benefit}，不用注册，完全免费。赶快点这里领取：`;
}

function shareCopy() {
  return `${shareMessage()}${decodeURI(canonicalUrl)}`;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function directShareUrl(platform) {
  const url = encodeURIComponent(canonicalUrl);
  const title = encodeURIComponent(`我送给你一本好书《${book.title}》`);
  const message = encodeURIComponent(shareMessage());
  const text = encodeURIComponent(shareCopy());
  return {
    weibo: `https://service.weibo.com/share/share.php?url=${url}&title=${message}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    whatsapp: `https://wa.me/?text=${text}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    x: `https://twitter.com/intent/tweet?text=${message}&url=${url}`,
    reddit: `https://www.reddit.com/submit?url=${url}&title=${title}`,
    pinterest: `https://pinterest.com/pin/create/button/?url=${url}&description=${message}`,
  }[platform];
}

async function shareToPlatform(platform, label, button) {
  const direct = directShareUrl(platform);
  if (direct) {
    window.open(direct, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await copyText(shareCopy());
    const previous = button.textContent;
    button.textContent = "已复制";
    window.setTimeout(() => { button.textContent = previous; }, 1600);
    showToast(`分享文案和链接已复制，请打开${label}粘贴发布`);
  } catch { showToast("自动复制失败，请手动复制上方内容", "error"); }
}

function setupSharePanel() {
  document.querySelector(".share-copy-preview p").textContent = shareMessage();
  const platforms = document.querySelector(".share-platforms");
  platforms.replaceChildren(...sharePlatforms.map(([id, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.shareMode = directShareUrl(id) ? "direct" : "copy";
    button.textContent = label;
    button.title = button.dataset.shareMode === "direct" ? `打开${label}分享` : `复制文案和链接，再到${label}分享`;
    button.addEventListener("click", () => shareToPlatform(id, label, button));
    return button;
  }));
  document.querySelector(".share-copy").addEventListener("click", async () => {
    try { await copyText(shareCopy()); showToast("分享文案和链接已复制"); }
    catch { showToast("复制失败，请手动复制上方内容", "error"); }
  });
  document.querySelector(".share-native").addEventListener("click", async () => {
    if (!navigator.share) return shareToPlatform("native", "你常用的社交平台", document.querySelector(".share-native"));
    try { await navigator.share({ title: `《${book.title}》｜文硕阁`, text: shareMessage(), url: canonicalUrl }); }
    catch (error) { if (error?.name !== "AbortError") showToast("系统分享暂时不可用", "error"); }
  });
}

function progressKey() { return `${READER_PROGRESS_PREFIX}${book.id}`; }

function setTocOpen(open) {
  reader.tocOpen = open;
  elements.reader.classList.toggle("toc-open", open);
  elements.toc.hidden = !open;
  elements.reader.querySelector('[data-reader-toc="toggle"]').setAttribute("aria-expanded", String(open));
}

function applyReaderFontRules() {
  if (!reader.rendition) return;
  const fontSize = `${reader.fontSize / 10}pt`;
  reader.rendition.themes.override("font-size", fontSize, true);
  const stylesheet = `
    :root { font-size: ${fontSize} !important; }
    body { font-size: 1rem !important; }
    p, li, blockquote, dd, dt, td, th { font-size: 1rem !important; }
    p *, li *, blockquote *, dd *, dt *, td *, th * { font-size: inherit !important; }
  `;
  for (const content of reader.rendition.getContents?.() ?? []) {
    const documentNode = content.document;
    if (!documentNode?.head) continue;
    let style = documentNode.getElementById("wenshuoge-reader-font");
    if (!style) {
      style = documentNode.createElement("style");
      style.id = "wenshuoge-reader-font";
      documentNode.head.append(style);
    }
    style.textContent = stylesheet;
  }
}

function applyReaderAppearance() {
  if (!reader.rendition) return;
  reader.rendition.themes.select(reader.dark ? "night" : "paper");
  applyReaderFontRules();
  elements.reader.classList.toggle("is-dark", reader.dark);
  elements.reader.querySelectorAll("[data-reader-font]").forEach((button) => {
    button.title = `当前字号 ${reader.fontSize}%`;
  });
}

function currentFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function readerFullscreenTarget() {
  return elements.reader.querySelector(".reader-shell");
}

function updateFullscreenButton() {
  const button = elements.reader.querySelector("[data-reader-fullscreen]");
  const active = currentFullscreenElement() === readerFullscreenTarget();
  button.textContent = active ? "退出" : "全屏";
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", active ? "退出全屏阅读" : "进入全屏阅读");
  window.requestAnimationFrame(() => {
    if (reader.rendition) reader.rendition.resize(elements.stage.clientWidth, elements.stage.clientHeight);
  });
}

async function toggleFullscreen() {
  try {
    const target = readerFullscreenTarget();
    if (currentFullscreenElement() === target) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) await exit.call(document);
      return;
    }
    const request = target.requestFullscreen || target.webkitRequestFullscreen;
    if (!request) throw new Error("unsupported");
    await request.call(target);
  } catch {
    showToast("当前浏览器暂不支持全屏阅读，请使用浏览器自带的全屏功能。", "error");
  }
}

function exitFullscreen() {
  if (currentFullscreenElement() !== readerFullscreenTarget()) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (exit) Promise.resolve(exit.call(document)).catch(() => {});
}

function flattenToc(items, depth = 0, output = []) {
  for (const item of items) {
    output.push({ label: item.label?.trim() || "未题章节", href: item.href, depth });
    if (item.subitems?.length) flattenToc(item.subitems, depth + 1, output);
  }
  return output;
}

function renderToc(items) {
  const chapters = flattenToc(items || []);
  if (!chapters.length) {
    elements.tocList.innerHTML = '<p class="reader-toc-status">这册书未提供可识别的章节目录。</p>';
    return;
  }
  elements.tocList.replaceChildren(...chapters.map((chapter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = chapter.label;
    button.dataset.href = chapter.href;
    button.style.setProperty("--toc-indent", `${18 + Math.min(chapter.depth, 4) * 15}px`);
    button.addEventListener("click", async () => { await reader.rendition?.display(chapter.href); if (innerWidth <= 760) setTocOpen(false); });
    return button;
  }));
}

function updateProgress(location) {
  if (!location?.start?.cfi) return;
  reader.lastLocation = location;
  let percentage = 0;
  try { if (reader.instance.locations.length() > 0) percentage = reader.instance.locations.percentageFromCfi(location.start.cfi); } catch { /* not generated yet */ }
  const percent = Math.max(0, Math.min(100, Math.round(percentage * 100)));
  elements.reader.querySelector(".reader-progress").textContent = percent ? `已读 ${percent}% · 进度已保存在本浏览器` : "进度已保存在本浏览器";
  storageSet(progressKey(), JSON.stringify({ cfi: location.start.cfi, percentage, updatedAt: Date.now(), title: book.title }));
  const href = location.start.href?.split("#")[0];
  elements.tocList.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.href?.split("#")[0] === href));
}

function destroyReader() {
  reader.rendition?.destroy();
  reader.instance?.destroy();
  reader.instance = null;
  reader.rendition = null;
  reader.lastLocation = null;
  setTocOpen(false);
  elements.tocList.innerHTML = '<p class="reader-toc-status">正在整理目录……</p>';
  elements.stage.replaceChildren();
}

async function openReader() {
  if (!window.ePub) return showToast("在线阅读器加载失败，请刷新页面后重试。", "error");
  destroyReader();
  reader.fontSize = savedReaderFontSize();
  reader.dark = false;
  elements.reader.querySelector(".reader-title").textContent = book.title;
  elements.reader.querySelector(".reader-progress").textContent = "正在载入上次阅读进度……";
  elements.stage.innerHTML = '<div class="reader-loading">正在整理篇章，请稍候……</div>';
  elements.reader.showModal();
  try {
    const authorization = await fetch("/api/readers/authorize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: book.paths.epub, visitorId: getVisitorId() }),
    });
    const access = await authorization.json().catch(() => ({}));
    if (!authorization.ok) throw new Error(access.message || "暂时无法打开这册书。");
    reader.instance = window.ePub(access.url, { openAs: "epub" });
    reader.rendition = reader.instance.renderTo(elements.stage, { width: "100%", height: "100%", flow: "paginated", spread: "auto", allowScriptedContent: false });
    reader.rendition.themes.register("paper", { body: { color: "#332820 !important", background: "#fbf6ea !important", "line-height": "1.9 !important" }, a: { color: "#8d332b !important" } });
    reader.rendition.themes.register("night", { body: { color: "#dfd4c1 !important", background: "#211b18 !important", "line-height": "1.9 !important" }, a: { color: "#d69a83 !important" } });
    reader.rendition.on("rendered", applyReaderFontRules);
    applyReaderAppearance();
    reader.rendition.on("relocated", updateProgress);
    let saved;
    try { saved = JSON.parse(storageGet(progressKey()) || "null"); } catch { saved = null; }
    try { await reader.rendition.display(saved?.cfi || undefined); } catch { await reader.rendition.display(); }
    elements.stage.querySelector(".reader-loading")?.remove();
    reader.instance.loaded.navigation.then((navigation) => renderToc(navigation?.toc || [])).catch(() => renderToc([]));
    reader.instance.ready.then(() => reader.instance.locations.generate(1100)).then(() => { if (reader.lastLocation) updateProgress(reader.lastLocation); }).catch(() => {});
  } catch (error) {
    elements.stage.innerHTML = `<div class="reader-error"><strong>暂时无法展开这册书</strong><span>${error instanceof Error ? error.message : "请稍后重试"}</span></div>`;
    elements.reader.querySelector(".reader-progress").textContent = "阅读器加载失败";
  }
}

applyCoverPalette();
setupSharePanel();
loadDownloadStats();
document.querySelectorAll("[data-download]").forEach((button) => button.addEventListener("click", () => startDownload(button.dataset.download, button)));
document.querySelector("[data-read-online]")?.addEventListener("click", openReader);
elements.reader.querySelector(".reader-close").addEventListener("click", () => elements.reader.close());
elements.reader.addEventListener("close", () => { exitFullscreen(); destroyReader(); });
elements.reader.addEventListener("click", (event) => { if (event.target === elements.reader) elements.reader.close(); });
elements.reader.querySelector('[data-reader-toc="toggle"]').addEventListener("click", () => setTocOpen(!reader.tocOpen));
elements.reader.querySelector('[data-reader-toc="close"]').addEventListener("click", () => setTocOpen(false));
document.querySelectorAll("[data-reader-nav]").forEach((button) => button.addEventListener("click", () => reader.rendition?.[button.dataset.readerNav === "next" ? "next" : "prev"]()));
document.querySelectorAll("[data-reader-font]").forEach((button) => button.addEventListener("click", () => { reader.fontSize = Math.max(50, reader.fontSize + (button.dataset.readerFont === "larger" ? READER_FONT_STEP : -READER_FONT_STEP)); storageSet(READER_FONT_SIZE_KEY, String(reader.fontSize)); applyReaderAppearance(); }));
document.querySelector("[data-reader-theme]").addEventListener("click", () => { reader.dark = !reader.dark; applyReaderAppearance(); });
elements.reader.querySelector("[data-reader-fullscreen]").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
updateFullscreenButton();
document.addEventListener("keydown", (event) => {
  if (!elements.reader.open || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === "ArrowLeft") reader.rendition?.prev();
  if (event.key === "ArrowRight") reader.rendition?.next();
});
