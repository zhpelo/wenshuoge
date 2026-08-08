const PAGE_SIZE = 16;
const DETAIL_SHARD_SIZE = 500;
const CATALOG_REVISION = "037-1";
const palettes = [
  ["#7b2e29", "#f0d29d"], ["#31524b", "#e9d5a6"], ["#3d4f61", "#ead3a6"],
  ["#82572e", "#f2ddb4"], ["#553a5a", "#ebd1aa"], ["#294956", "#e2c996"],
  ["#765143", "#f0d8af"], ["#465b3e", "#edd7a5"],
];

const state = {
  books: [],
  filtered: [],
  categories: [],
  query: "",
  format: "all",
  category: "all",
  visible: PAGE_SIZE,
  detailCache: new Map(),
  dialogRequest: 0,
};

const elements = {
  grid: document.querySelector("#book-grid"),
  template: document.querySelector("#book-card-template"),
  count: document.querySelector("#result-count"),
  empty: document.querySelector("#empty-state"),
  more: document.querySelector("#load-more"),
  clear: document.querySelector("#clear-search"),
  dialog: document.querySelector("#book-dialog"),
  heroQuery: document.querySelector("#hero-query"),
  catalogQuery: document.querySelector("#catalog-query"),
  categoryBrowser: document.querySelector("#category-browser"),
};

function colorFor(book) {
  const hash = [...`${book.id}${book.title}`].reduce((value, char) => ((value * 31) + char.codePointAt(0)) >>> 0, 7);
  return palettes[hash % palettes.length];
}

function formatSize(bytes) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function bookUrl(book, format) {
  return `/api/book?key=${encodeURIComponent(book.paths[format])}`;
}

function applyCover(node, book) {
  const [background, ink] = colorFor(book);
  node.style.setProperty("--book-color", background);
  node.style.setProperty("--cover-ink", ink);
  node.querySelector(".cover-title").textContent = book.title;
  node.querySelector(".cover-author").textContent = book.author || "佚名";
}

function makeActions(container, book) {
  container.replaceChildren();
  for (const format of book.formats) {
    const link = document.createElement("a");
    link.href = bookUrl(book, format);
    link.target = "_blank";
    link.rel = "noopener";
    link.className = format;
    link.textContent = `${format.toUpperCase()} · ${formatSize(book.sizes[format])}`;
    link.setAttribute("aria-label", `${book.title} ${format.toUpperCase()} 格式`);
    container.append(link);
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

async function openDialog(book) {
  const requestId = ++state.dialogRequest;
  const dialog = elements.dialog;
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

  const cover = elements.template.content.querySelector(".book-object").cloneNode(true);
  applyCover(cover, book);
  dialog.querySelector(".dialog-cover-wrap").replaceChildren(cover);
  if (!dialog.open) dialog.showModal();

  try {
    const detail = await loadDetail(book.id);
    if (!detail || requestId !== state.dialogRequest || !dialog.open) return;
    const [description, period, authorInfo, tags, sources, reviewed, batch, inheritedFrom] = detail;
    dialog.querySelector(".dialog-description").textContent = description || "阁中暂未收录本书提要，可直接选取格式开始阅读。";
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
    if (requestId === state.dialogRequest) {
      dialog.querySelector(".dialog-description").textContent = "书籍提要暂时无法展开，请稍后再试。";
    }
  }
}

function makeCard(book) {
  const card = elements.template.content.firstElementChild.cloneNode(true);
  applyCover(card.querySelector(".book-object"), book);
  card.querySelector("h3").textContent = book.title;
  card.querySelector(".book-author").textContent = `著者 · ${book.author || "佚名"}`;
  makeTags(card.querySelector(".book-tags"), [book.category, ...book.subjects], 2);
  makeActions(card.querySelector(".book-actions"), book);
  card.querySelector(".book-object").addEventListener("click", () => openDialog(book));
  return card;
}

function renderCount() {
  const lead = state.query
    ? `“${state.query}” 找到 `
    : state.category !== "all" ? `${state.category}共有 ` : "阁中现藏 ";
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
    const haystack = normalize([book.title, book.author, book.category, book.era, ...book.subjects].join(" "));
    return haystack.includes(query);
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

document.querySelector("#hero-search").addEventListener("submit", (event) => {
  event.preventDefault();
  searchFor(elements.heroQuery.value, { scroll: true });
});
document.querySelector("#catalog-search").addEventListener("submit", (event) => {
  event.preventDefault();
  searchFor(elements.catalogQuery.value);
});
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
elements.dialog.addEventListener("close", () => { state.dialogRequest += 1; });
elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) elements.dialog.close(); });
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
      if (formatMask & 1) {
        formats.push("epub");
        paths.epub = `ebookfiles/${id}/${filename}.epub`;
        sizes.epub = epubSize;
      }
      if (formatMask & 2) {
        formats.push("pdf");
        paths.pdf = `ebookfiles/${id}/${filename}.pdf`;
        sizes.pdf = pdfSize;
      }
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
