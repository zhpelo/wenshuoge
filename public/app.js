const PAGE_SIZE = 16;
const DETAIL_SHARD_SIZE = 500;
const CATALOG_REVISION = "044-1";
const READER_PROGRESS_PREFIX = "wenshuoge:reader:";
const VISITOR_KEY = "wenshuoge:visitor";
const palettes = [
  ["#7b2e29", "#f0d29d"], ["#31524b", "#e9d5a6"], ["#3d4f61", "#ead3a6"],
  ["#82572e", "#f2ddb4"], ["#553a5a", "#ebd1aa"], ["#294956", "#e2c996"],
  ["#765143", "#f0d8af"], ["#465b3e", "#edd7a5"],
];

const sharePlatforms = [
  ["wechat", "微信朋友圈"], ["douyin", "抖音"], ["weibo", "微博"], ["xiaohongshu", "小红书"],
  ["bilibili", "B站"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["tiktok", "TikTok"],
  ["whatsapp", "WhatsApp"], ["linkedin", "LinkedIn"], ["x", "X"], ["snapchat", "Snapchat"],
  ["discord", "Discord"], ["threads", "Threads"], ["reddit", "Reddit"], ["pinterest", "Pinterest"],
];

const state = {
  books: [], filtered: [], categories: [], query: "", format: "all", category: "all", visible: PAGE_SIZE,
  detailCache: new Map(), dialogRequest: 0, activeBook: null, statsRequest: 0,
};

const reader = {
  book: null, rendition: null, activeBook: null, lastLocation: null, fontSize: 100, dark: false, tocOpen: false,
};

const elements = {
  grid: document.querySelector("#book-grid"),
  template: document.querySelector("#book-card-template"),
  count: document.querySelector("#result-count"),
  empty: document.querySelector("#empty-state"),
  more: document.querySelector("#load-more"),
  clear: document.querySelector("#clear-search"),
  dialog: document.querySelector("#book-dialog"),
  reader: document.querySelector("#epub-reader"),
  readerStage: document.querySelector("#reader-stage"),
  readerToc: document.querySelector("#reader-toc"),
  readerTocList: document.querySelector(".reader-toc-list"),
  heroQuery: document.querySelector("#hero-query"),
  catalogQuery: document.querySelector("#catalog-query"),
  categoryBrowser: document.querySelector("#category-browser"),
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

function colorFor(book) {
  const hash = [...`${book.id}${book.title}`].reduce((value, char) => ((value * 31) + char.codePointAt(0)) >>> 0, 7);
  return palettes[hash % palettes.length];
}

function formatSize(bytes) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function applyCover(node, book) {
  const [background, ink] = colorFor(book);
  node.style.setProperty("--book-color", background);
  node.style.setProperty("--cover-ink", ink);
  node.querySelector(".cover-title").textContent = book.title;
  node.querySelector(".cover-author").textContent = book.author || "佚名";
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode can reject storage */ }
}

function getVisitorId() {
  let id = storageGet(VISITOR_KEY);
  if (!id || !/^[A-Za-z0-9_-]{20,80}$/u.test(id)) {
    id = crypto.randomUUID().replaceAll("-", "");
    storageSet(VISITOR_KEY, id);
  }
  return id;
}

async function startDownload(book, format, button) {
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
    window.setTimeout(() => loadDownloadStats(book, { fresh: true }), 1800);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "下载失败，请稍后再试。", "error");
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

function makeActions(container, book) {
  container.replaceChildren();
  if (book.formats.includes("epub")) {
    const read = document.createElement("button");
    read.type = "button";
    read.className = "read-online";
    read.textContent = "在线阅读";
    read.setAttribute("aria-label", `在线阅读《${book.title}》`);
    read.addEventListener("click", () => openReader(book));
    container.append(read);
  }
  for (const format of book.formats) {
    const download = document.createElement("button");
    download.type = "button";
    download.className = `download-${format}`;
    download.textContent = `下载 ${format.toUpperCase()} · ${formatSize(book.sizes[format])}`;
    download.setAttribute("aria-label", `下载《${book.title}》${format.toUpperCase()} 格式`);
    download.addEventListener("click", () => startDownload(book, format, download));
    container.append(download);
  }
}

function makeTags(container, values, limit = 6) {
  const unique = [...new Set(values.filter(Boolean))].slice(0, limit);
  container.replaceChildren(...unique.map((value) => {
    const span = document.createElement("span");
    span.textContent = value;
    return span;
  }));
}

function detailShardFor(id) {
  return String(Math.floor(Number(id) / DETAIL_SHARD_SIZE)).padStart(2, "0");
}

async function loadDetail(id) {
  const shard = detailShardFor(id);
  if (!state.detailCache.has(shard)) {
    state.detailCache.set(shard, fetch(`/book-details-v2/${shard}.json?revision=${CATALOG_REVISION}`).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }));
  }
  const data = await state.detailCache.get(shard);
  return data.b[id];
}

function renderSources(container, sources) {
  container.replaceChildren();
  for (const [title, url] of sources) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = title;
    container.append(link);
  }
  container.closest(".dialog-sources").hidden = sources.length === 0;
}

function sharedBookUrl(book) {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("book", book.id);
  return url.href;
}

function shareCopy(book) {
  return `我在文硕阁发现了《${book.title}》（${book.author || "佚名"}），可以免费在线阅读：${sharedBookUrl(book)}`;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function directShareUrl(platform, book) {
  const url = encodeURIComponent(sharedBookUrl(book));
  const title = encodeURIComponent(`推荐《${book.title}》｜文硕阁免费在线阅读`);
  const text = encodeURIComponent(shareCopy(book));
  return {
    weibo: `https://service.weibo.com/share/share.php?url=${url}&title=${title}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    whatsapp: `https://wa.me/?text=${text}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    x: `https://twitter.com/intent/tweet?text=${title}&url=${url}`,
    reddit: `https://www.reddit.com/submit?url=${url}&title=${title}`,
    pinterest: `https://pinterest.com/pin/create/button/?url=${url}&description=${title}`,
  }[platform];
}

async function shareToPlatform(platform, label, book) {
  const direct = directShareUrl(platform, book);
  if (direct) {
    window.open(direct, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await copyText(shareCopy(book));
    showToast(`推荐语和链接已复制，请打开${label}发布分享`);
  } catch {
    showToast(`请复制浏览器地址，然后打开${label}分享`, "error");
  }
}

function renderSharePanel(book) {
  const panel = elements.dialog.querySelector(".share-panel");
  panel.open = false;
  const platforms = panel.querySelector(".share-platforms");
  platforms.replaceChildren(...sharePlatforms.map(([id, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.platform = id;
    button.textContent = label;
    button.addEventListener("click", () => shareToPlatform(id, label, book));
    return button;
  }));
  panel.querySelector(".share-copy").onclick = async () => {
    try {
      await copyText(sharedBookUrl(book));
      showToast("书籍链接已复制");
    } catch { showToast("复制失败，请复制浏览器地址", "error"); }
  };
  panel.querySelector(".share-native").onclick = async () => {
    if (!navigator.share) {
      await shareToPlatform("native", "你常用的社交平台", book);
      return;
    }
    try {
      await navigator.share({ title: `《${book.title}》｜文硕阁`, text: `推荐一本好书：《${book.title}》`, url: sharedBookUrl(book) });
    } catch (error) {
      if (error?.name !== "AbortError") showToast("系统分享暂时不可用", "error");
    }
  };
}

async function loadDownloadStats(book, { fresh = false } = {}) {
  const requestId = ++state.statsRequest;
  const node = elements.dialog.querySelector(".dialog-download-count");
  node.textContent = "正在读取下载数据……";
  try {
    const response = await fetch(`/api/downloads?book=${encodeURIComponent(book.id)}`, fresh ? { cache: "no-store" } : undefined);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (requestId !== state.statsRequest || state.activeBook?.id !== book.id) return;
    node.textContent = `已下载 ${data.total.toLocaleString("zh-CN")} 次 · EPUB ${data.epub.toLocaleString("zh-CN")} · PDF ${data.pdf.toLocaleString("zh-CN")}`;
  } catch {
    if (requestId === state.statsRequest) node.textContent = "下载数据暂时不可用";
  }
}

function setSharedBookParam(book) {
  const url = new URL(location.href);
  book ? url.searchParams.set("book", book.id) : url.searchParams.delete("book");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function openDialog(book, { updateUrl = true } = {}) {
  const requestId = ++state.dialogRequest;
  const dialog = elements.dialog;
  state.activeBook = book;
  if (updateUrl) setSharedBookParam(book);
  dialog.querySelector("h2").textContent = book.title;
  dialog.querySelector(".dialog-author").textContent = `著者 · ${book.author || "佚名"}`;
  dialog.querySelector(".dialog-period").textContent = book.era;
  dialog.querySelector(".dialog-category").textContent = book.category;
  dialog.querySelector(".dialog-description").textContent = "正在展开书籍提要……";
  dialog.querySelector(".dialog-author-info").hidden = true;
  dialog.querySelector(".dialog-sources").hidden = true;
  dialog.querySelector(".dialog-status").textContent = "自动整理";
  makeTags(dialog.querySelector(".dialog-tags"), [book.category, book.era, ...book.subjects]);
  makeActions(dialog.querySelector(".dialog-actions"), book);
  renderSharePanel(book);
  loadDownloadStats(book);

  const cover = elements.template.content.querySelector(".book-object").cloneNode(true);
  applyCover(cover, book);
  dialog.querySelector(".dialog-cover-wrap").replaceChildren(cover);
  if (!dialog.open) dialog.showModal();

  try {
    const detail = await loadDetail(book.id);
    if (!detail || requestId !== state.dialogRequest || !dialog.open) return;
    const [description, period, authorInfo, tags, sources, reviewed, batch, inheritedFrom] = detail;
    dialog.querySelector(".dialog-description").textContent = description || "阁中暂未收录本书提要，可直接开始在线阅读。";
    dialog.querySelector(".dialog-period").textContent = period || book.era;
    makeTags(dialog.querySelector(".dialog-tags"), [book.category, book.era, ...tags]);
    const authorNode = dialog.querySelector(".dialog-author-info");
    authorNode.textContent = authorInfo;
    authorNode.hidden = !authorInfo;
    renderSources(dialog.querySelector(".dialog-source-list"), sources ?? []);
    dialog.querySelector(".dialog-status").textContent = reviewed
      ? inheritedFrom
        ? `同作品资料已核验 · 第 ${batch} 批 · 继承自书目 ${inheritedFrom}`
        : `资料已核验 · 第 ${batch} 批`
      : "依据原书元数据自动整理";
  } catch (error) {
    console.error("书籍详情加载失败", error);
    if (requestId === state.dialogRequest) dialog.querySelector(".dialog-description").textContent = "书籍提要暂时无法展开，请稍后再试。";
  }
}

function readerProgressKey(book) {
  return `${READER_PROGRESS_PREFIX}${book.id}`;
}

function savedReaderProgress(book) {
  try { return JSON.parse(storageGet(readerProgressKey(book)) || "null"); } catch { return null; }
}

function applyReaderAppearance() {
  if (!reader.rendition) return;
  reader.rendition.themes.select(reader.dark ? "night" : "paper");
  reader.rendition.themes.override("font-size", `${reader.fontSize}%`, true);
  elements.reader.classList.toggle("is-dark", reader.dark);
  elements.reader.querySelectorAll("[data-reader-font]").forEach((button) => {
    button.title = `当前字号 ${reader.fontSize}%`;
  });
}

function setReaderTocOpen(open) {
  reader.tocOpen = Boolean(open);
  elements.reader.classList.toggle("toc-open", reader.tocOpen);
  elements.readerToc.hidden = !reader.tocOpen;
  const toggle = elements.reader.querySelector('[data-reader-toc="toggle"]');
  toggle.setAttribute("aria-expanded", String(reader.tocOpen));
  toggle.setAttribute("aria-label", reader.tocOpen ? "关闭章节目录" : "打开章节目录");
}

function normalizedChapterHref(href) {
  if (!href) return "";
  const value = href.split("#", 1)[0];
  try { return decodeURIComponent(value); } catch { return value; }
}

function updateCurrentChapter(href) {
  const current = normalizedChapterHref(href);
  elements.readerTocList.querySelectorAll("[data-chapter-href]").forEach((button) => {
    const active = Boolean(current) && normalizedChapterHref(button.dataset.chapterHref).endsWith(current);
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "location");
    else button.removeAttribute("aria-current");
  });
}

function makeTocList(items, depth = 0) {
  const list = document.createElement("ol");
  for (const item of items) {
    const entry = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label?.trim() || "未命名章节";
    button.dataset.chapterHref = item.href || "";
    button.style.setProperty("--toc-indent", `${18 + (depth * 14)}px`);
    button.addEventListener("click", async () => {
      if (!reader.rendition || !item.href) return;
      try {
        await reader.rendition.display(item.href);
        setReaderTocOpen(false);
      } catch (error) {
        console.warn("章节跳转失败", error);
        showToast("暂时无法跳转到这一章，请稍后重试。", "error");
      }
    });
    entry.append(button);
    if (item.subitems?.length) entry.append(makeTocList(item.subitems, depth + 1));
    list.append(entry);
  }
  return list;
}

function renderReaderToc(items) {
  if (!items?.length) {
    const status = document.createElement("p");
    status.className = "reader-toc-status";
    status.textContent = "这册书没有提供章节目录。";
    elements.readerTocList.replaceChildren(status);
    return;
  }
  elements.readerTocList.replaceChildren(makeTocList(items));
  updateCurrentChapter(reader.lastLocation?.start?.href);
}

function updateReaderProgress(location) {
  if (!reader.book || !reader.activeBook || !location?.start?.cfi) return;
  reader.lastLocation = location;
  let percentage = 0;
  try {
    if (reader.book.locations.length() > 0) percentage = reader.book.locations.percentageFromCfi(location.start.cfi);
  } catch { /* generated locations may not be ready yet */ }
  const percent = Math.max(0, Math.min(100, Math.round(percentage * 100)));
  elements.reader.querySelector(".reader-progress").textContent = percent > 0
    ? `已读 ${percent}% · 进度已保存在本浏览器`
    : "进度已保存在本浏览器";
  storageSet(readerProgressKey(reader.activeBook), JSON.stringify({
    cfi: location.start.cfi, percentage, updatedAt: Date.now(), title: reader.activeBook.title,
  }));
  updateCurrentChapter(location.start.href);
}

function destroyReader() {
  reader.rendition?.destroy();
  reader.book?.destroy();
  reader.book = null;
  reader.rendition = null;
  reader.activeBook = null;
  reader.lastLocation = null;
  setReaderTocOpen(false);
  elements.readerTocList.innerHTML = '<p class="reader-toc-status">正在整理目录……</p>';
  elements.readerStage.replaceChildren();
}

async function openReader(book) {
  if (!window.ePub) {
    showToast("在线阅读器加载失败，请刷新页面后重试。", "error");
    return;
  }
  if (elements.dialog.open) elements.dialog.close();
  destroyReader();
  reader.activeBook = book;
  reader.fontSize = 100;
  reader.dark = false;
  setReaderTocOpen(false);
  elements.reader.querySelector(".reader-title").textContent = book.title;
  elements.reader.querySelector(".reader-progress").textContent = "正在载入上次阅读进度……";
  elements.readerStage.innerHTML = '<div class="reader-loading">正在整理篇章，请稍候……</div>';
  elements.reader.showModal();

  try {
    const authorization = await fetch("/api/readers/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: book.paths.epub, visitorId: getVisitorId() }),
    });
    const access = await authorization.json().catch(() => ({}));
    if (!authorization.ok) throw new Error(access.message || "暂时无法打开这册书。");
    reader.book = window.ePub(access.url, { openAs: "epub" });
    reader.rendition = reader.book.renderTo(elements.readerStage, {
      width: "100%", height: "100%", flow: "paginated", spread: "auto", allowScriptedContent: false,
    });
    reader.rendition.themes.register("paper", {
      body: { color: "#332820 !important", background: "#fbf6ea !important", "line-height": "1.9 !important" },
      a: { color: "#8d332b !important" },
    });
    reader.rendition.themes.register("night", {
      body: { color: "#dfd4c1 !important", background: "#211b18 !important", "line-height": "1.9 !important" },
      a: { color: "#d69a83 !important" },
    });
    applyReaderAppearance();
    reader.rendition.on("relocated", updateReaderProgress);
    const saved = savedReaderProgress(book);
    try { await reader.rendition.display(saved?.cfi || undefined); }
    catch { await reader.rendition.display(); }
    elements.readerStage.querySelector(".reader-loading")?.remove();

    const activeReaderBook = reader.book;
    activeReaderBook.loaded.navigation.then((navigation) => {
      if (reader.book === activeReaderBook) renderReaderToc(navigation?.toc ?? []);
    }).catch((error) => {
      console.warn("章节目录加载失败", error);
      if (reader.book === activeReaderBook) renderReaderToc([]);
    });

    reader.book.ready.then(() => reader.book.locations.generate(1100)).then(() => {
      if (reader.lastLocation) updateReaderProgress(reader.lastLocation);
    }).catch((error) => console.warn("阅读百分比生成失败", error));
  } catch (error) {
    console.error("在线阅读器加载失败", error);
    elements.readerStage.innerHTML = '<div class="reader-error"><strong>暂时无法展开这册书</strong><span>请稍后重试，或下载 EPUB 到本地阅读。</span></div>';
    elements.reader.querySelector(".reader-progress").textContent = "阅读器加载失败";
  }
}

function makeCard(book) {
  const card = elements.template.content.firstElementChild.cloneNode(true);
  applyCover(card.querySelector(".book-object"), book);
  card.querySelector("h3").textContent = book.title;
  card.querySelector(".book-author").textContent = `著者 · ${book.author || "佚名"}`;
  makeTags(card.querySelector(".book-tags"), [book.category, ...book.subjects], 2);
  card.querySelector(".book-object").addEventListener("click", () => openDialog(book));
  return card;
}

function renderCount() {
  const lead = state.query ? `“${state.query}” 找到 ` : state.category !== "all" ? `${state.category}共有 ` : "阁中现藏 ";
  const strong = document.createElement("strong");
  strong.textContent = state.filtered.length.toLocaleString("zh-CN");
  elements.count.replaceChildren(document.createTextNode(lead), strong, document.createTextNode(" 册书"));
}

function render() {
  const visibleBooks = state.filtered.slice(0, state.visible);
  elements.grid.replaceChildren(...visibleBooks.map(makeCard));
  elements.grid.setAttribute("aria-busy", "false");
  elements.empty.hidden = state.filtered.length !== 0;
  elements.grid.hidden = state.filtered.length === 0;
  elements.more.hidden = state.visible >= state.filtered.length;
  elements.clear.hidden = !state.query && state.format === "all" && state.category === "all";
  renderCount();
}

function normalize(value) {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s·《》「」『』，。！？、:：_-]+/gu, "");
}

function filterBooks({ reset = true } = {}) {
  const query = normalize(state.query);
  state.filtered = state.books.filter((book) => {
    if (state.format !== "all" && !book.formats.includes(state.format)) return false;
    if (state.category !== "all" && book.category !== state.category) return false;
    if (!query) return true;
    return normalize([book.title, book.author, book.category, book.era, ...book.subjects].join(" ")).includes(query);
  });
  if (query) {
    state.filtered.sort((a, b) => {
      const aTitle = normalize(a.title);
      const bTitle = normalize(b.title);
      return Number(bTitle === query) - Number(aTitle === query)
        || Number(bTitle.startsWith(query)) - Number(aTitle.startsWith(query))
        || Number(a.id) - Number(b.id);
    });
  }
  if (reset) state.visible = PAGE_SIZE;
  render();
}

function syncUrl() {
  const url = new URL(location.href);
  state.query ? url.searchParams.set("q", state.query) : url.searchParams.delete("q");
  state.category !== "all" ? url.searchParams.set("category", state.category) : url.searchParams.delete("category");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function searchFor(value, { scroll = false } = {}) {
  state.query = value.trim();
  elements.heroQuery.value = state.query;
  elements.catalogQuery.value = state.query;
  filterBooks();
  syncUrl();
  if (scroll) document.querySelector("#library").scrollIntoView({ behavior: "smooth" });
}

function updateCategoryButtons() {
  elements.categoryBrowser.querySelectorAll("[data-category]").forEach((button) => {
    const active = button.dataset.category === state.category;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function selectCategory(category, { scroll = false } = {}) {
  state.category = state.categories.some(([name]) => name === category) ? category : "all";
  updateCategoryButtons();
  filterBooks();
  syncUrl();
  if (scroll) document.querySelector("#catalog-results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderCategories(total) {
  const categories = [["all", total], ...state.categories.filter(([, count]) => count > 0)];
  elements.categoryBrowser.replaceChildren(...categories.map(([name, count]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.category = name;
    const label = document.createElement("strong");
    label.textContent = name === "all" ? "全部藏书" : name;
    const number = document.createElement("span");
    number.textContent = `${count.toLocaleString("zh-CN")} 册`;
    button.append(label, number);
    button.addEventListener("click", () => selectCategory(name, { scroll: true }));
    return button;
  }));
  updateCategoryButtons();
}

document.querySelector("#hero-search").addEventListener("submit", (event) => { event.preventDefault(); searchFor(elements.heroQuery.value, { scroll: true }); });
document.querySelector("#catalog-search").addEventListener("submit", (event) => { event.preventDefault(); searchFor(elements.catalogQuery.value); });
elements.catalogQuery.addEventListener("input", (event) => searchFor(event.target.value));
document.querySelectorAll("[data-query]").forEach((button) => button.addEventListener("click", () => searchFor(button.dataset.query, { scroll: true })));
document.querySelectorAll("[data-format]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-format]").forEach((item) => item.classList.toggle("active", item === button));
  state.format = button.dataset.format;
  filterBooks();
}));
elements.clear.addEventListener("click", () => {
  state.format = "all";
  state.category = "all";
  document.querySelectorAll("[data-format]").forEach((item) => item.classList.toggle("active", item.dataset.format === "all"));
  updateCategoryButtons();
  searchFor("");
});
elements.more.addEventListener("click", () => { state.visible += PAGE_SIZE; render(); });
elements.dialog.querySelector(".dialog-close").addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("close", () => {
  state.dialogRequest += 1;
  state.statsRequest += 1;
  state.activeBook = null;
  setSharedBookParam(null);
});
elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) elements.dialog.close(); });
elements.reader.querySelector(".reader-close").addEventListener("click", () => elements.reader.close());
elements.reader.addEventListener("close", destroyReader);
elements.reader.addEventListener("click", (event) => { if (event.target === elements.reader) elements.reader.close(); });
elements.reader.querySelector('[data-reader-toc="toggle"]').addEventListener("click", () => setReaderTocOpen(!reader.tocOpen));
elements.reader.querySelector('[data-reader-toc="close"]').addEventListener("click", () => setReaderTocOpen(false));
document.querySelectorAll("[data-reader-nav]").forEach((button) => button.addEventListener("click", () => {
  const action = button.dataset.readerNav === "next" ? "next" : "prev";
  reader.rendition?.[action]();
}));
document.querySelectorAll("[data-reader-font]").forEach((button) => button.addEventListener("click", () => {
  reader.fontSize = Math.max(75, Math.min(150, reader.fontSize + (button.dataset.readerFont === "larger" ? 10 : -10)));
  applyReaderAppearance();
}));
document.querySelector("[data-reader-theme]").addEventListener("click", () => { reader.dark = !reader.dark; applyReaderAppearance(); });
document.addEventListener("keydown", (event) => {
  if (!elements.reader.open || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === "ArrowLeft") reader.rendition?.prev();
  if (event.key === "ArrowRight") reader.rendition?.next();
});
document.querySelector("#year").textContent = new Date().getFullYear();

async function init() {
  try {
    const response = await fetch(`/books.json?revision=${CATALOG_REVISION}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.categories = data.c;
    state.books = data.b.map(([id, title, author, subjects, formatMask, filename, epubSize, pdfSize, category, era]) => {
      const formats = [];
      const paths = {};
      const sizes = {};
      if (formatMask & 1) { formats.push("epub"); paths.epub = `ebookfiles/${id}/${filename}.epub`; sizes.epub = epubSize; }
      if (formatMask & 2) { formats.push("pdf"); paths.pdf = `ebookfiles/${id}/${filename}.pdf`; sizes.pdf = pdfSize; }
      return { id, title, author, subjects, formats, paths, sizes, category, era };
    });
    document.querySelector("#hero-total").textContent = data.t.toLocaleString("zh-CN");
    document.querySelector("#reviewed-total").textContent = data.r.toLocaleString("zh-CN");
    renderCategories(data.t);
    const params = new URLSearchParams(location.search);
    const requestedCategory = params.get("category") || "all";
    state.category = state.categories.some(([name]) => name === requestedCategory) ? requestedCategory : "all";
    updateCategoryButtons();
    searchFor(params.get("q") || "");
    const sharedBook = state.books.find((book) => String(book.id) === params.get("book"));
    if (sharedBook) openDialog(sharedBook, { updateUrl: false });
  } catch (error) {
    console.error("书目加载失败", error);
    elements.grid.replaceChildren();
    elements.grid.hidden = true;
    elements.empty.hidden = false;
    elements.empty.querySelector("h3").textContent = "书目暂时无法展开";
    elements.empty.querySelector("p").textContent = "请稍后刷新页面再试。";
    elements.count.textContent = "书目加载失败";
  }
}

init();
