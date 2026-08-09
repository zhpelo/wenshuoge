const PAGE_SIZE = 96;

const state = {
  authors: [], filtered: [], visible: PAGE_SIZE, query: "", requestId: 0, biographyCache: new Map(),
};

const elements = {
  grid: document.querySelector("#author-grid"),
  empty: document.querySelector("#author-empty"),
  more: document.querySelector("#author-load-more"),
  count: document.querySelector("#author-result-count"),
  query: document.querySelector("#author-query"),
  dialog: document.querySelector("#author-dialog"),
};

function normalize(value) {
  return String(value).toLocaleLowerCase("zh-CN").replace(/[\s·・《》「」『』，。！？、:：;；()（）\[\]〔〕_-]+/gu, "");
}

function authorGlyph(name) {
  return name.match(/\p{L}/u)?.[0] ?? "著";
}

function makeTag(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

function makeAuthorCard(author, index) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `author-card tone-${index % 4}`;
  card.setAttribute("aria-label", `查看作者${author.name}的生平与作品`);

  const seal = document.createElement("span");
  seal.className = "author-seal";
  seal.textContent = authorGlyph(author.name);
  const copy = document.createElement("span");
  copy.className = "author-card-copy";
  const name = document.createElement("strong");
  name.textContent = author.name;
  const count = document.createElement("small");
  count.textContent = `阁中收录 ${author.works.length.toLocaleString("zh-CN")} 册`;
  const works = document.createElement("span");
  works.className = "author-card-books";
  works.textContent = author.works.slice(0, 2).map((book) => `《${book.title}》`).join(" · ");
  const tags = document.createElement("span");
  tags.className = "author-card-tags";
  const categories = [...new Set(author.works.map((book) => book.category).filter(Boolean))].slice(0, 2);
  tags.append(...categories.map(makeTag));
  copy.append(name, count, works, tags);
  card.append(seal, copy);
  card.addEventListener("click", () => openAuthor(author));
  return card;
}

function render() {
  const visible = state.filtered.slice(0, state.visible);
  elements.grid.replaceChildren(...visible.map(makeAuthorCard));
  elements.grid.setAttribute("aria-busy", "false");
  elements.grid.hidden = state.filtered.length === 0;
  elements.empty.hidden = state.filtered.length !== 0;
  elements.more.hidden = state.visible >= state.filtered.length;
  const lead = state.query ? `“${state.query}”寻到 ` : "轩中现有 ";
  elements.count.textContent = `${lead}${state.filtered.length.toLocaleString("zh-CN")} 位署名作者`;
}

function filterAuthors() {
  const query = normalize(state.query);
  state.filtered = query
    ? state.authors.filter((author) => author.searchText.includes(query))
    : state.authors;
  state.visible = PAGE_SIZE;
  render();
}

function safeWikipediaImage(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith("wikimedia.org") ? parsed.href : "";
  } catch { return ""; }
}

function renderBiography(data, author) {
  const dialog = elements.dialog;
  const description = dialog.querySelector(".author-description");
  const extract = dialog.querySelector(".author-extract");
  const link = dialog.querySelector(".wikipedia-link");
  const image = dialog.querySelector(".author-portrait img");
  const monogram = dialog.querySelector(".author-monogram");

  description.hidden = true;
  link.hidden = true;
  image.hidden = true;
  monogram.hidden = false;

  if (!data.found) {
    extract.textContent = data.message || `中文维基百科暂未收录“${author.name}”的独立词条。`;
    return;
  }

  description.textContent = data.description || (data.disambiguation ? "该名称在维基百科中对应多个词条" : "");
  description.hidden = !description.textContent;
  extract.textContent = data.disambiguation
    ? `${data.extract}\n\n提示：这是一个同名消歧义词条，请通过原词条确认具体人物。`
    : data.extract;
  if (data.pageUrl?.startsWith("https://zh.wikipedia.org/")) {
    link.href = data.pageUrl;
    link.hidden = false;
  }
  const imageUrl = safeWikipediaImage(data.thumbnail);
  if (imageUrl) {
    image.src = imageUrl;
    image.alt = `${data.title || author.name}肖像`;
    image.hidden = false;
    monogram.hidden = true;
  }
}

async function loadBiography(author, requestId) {
  try {
    if (!state.biographyCache.has(author.name)) {
      state.biographyCache.set(author.name, fetch(`/api/authors/biography?name=${encodeURIComponent(author.name)}`).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "作者资料暂时无法读取。");
        return data;
      }));
    }
    const data = await state.biographyCache.get(author.name);
    if (requestId === state.requestId && elements.dialog.open) renderBiography(data, author);
  } catch (error) {
    state.biographyCache.delete(author.name);
    if (requestId !== state.requestId || !elements.dialog.open) return;
    elements.dialog.querySelector(".author-extract").textContent = error instanceof Error ? error.message : "作者资料暂时无法读取。";
  }
}

function renderWorks(author) {
  const list = elements.dialog.querySelector(".author-work-list");
  list.replaceChildren(...author.works.map((book) => {
    const link = document.createElement("a");
    const slug = book.title.normalize("NFKC")
      .replace(/[《》「」『』【】〔〕（）()]/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLocaleLowerCase("zh-CN")
      .slice(0, 80) || "book";
    link.href = `/book/${encodeURIComponent(book.id)}/${slug}`;
    const title = document.createElement("strong");
    title.textContent = `《${book.title}》`;
    const meta = document.createElement("span");
    meta.textContent = [book.category, book.era].filter(Boolean).join(" · ");
    link.append(title, meta);
    return link;
  }));
}

function openAuthor(author) {
  const requestId = ++state.requestId;
  const dialog = elements.dialog;
  dialog.querySelector(".author-dialog-name").textContent = author.name;
  dialog.querySelector(".author-book-count").textContent = `文硕阁收录其署名作品 ${author.works.length.toLocaleString("zh-CN")} 册`;
  dialog.querySelector(".author-monogram").textContent = authorGlyph(author.name);
  dialog.querySelector(".author-monogram").hidden = false;
  dialog.querySelector(".author-portrait img").hidden = true;
  dialog.querySelector(".author-description").hidden = true;
  dialog.querySelector(".wikipedia-link").hidden = true;
  dialog.querySelector(".author-extract").textContent = "正在从中文维基百科寻访作者生平……";
  renderWorks(author);
  if (!dialog.open) dialog.showModal();
  loadBiography(author, requestId);
}

document.querySelector("#author-search").addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = elements.query.value.trim();
  filterAuthors();
});
elements.query.addEventListener("input", () => {
  state.query = elements.query.value.trim();
  filterAuthors();
});
elements.more.addEventListener("click", () => { state.visible += PAGE_SIZE; render(); });
elements.dialog.querySelector(".author-dialog-close").addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) elements.dialog.close(); });
elements.dialog.addEventListener("close", () => { state.requestId += 1; });
document.querySelector("#year").textContent = new Date().getFullYear();

async function init() {
  try {
    const response = await fetch("/authors.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.authors = data.a.map(([name, compactWorks]) => {
      const works = compactWorks.map(([id, title, category, era]) => ({ id, title, category, era }));
      return { name, works, searchText: normalize(`${name} ${works.map((book) => book.title).join(" ")}`) };
    });
    state.filtered = state.authors;
    document.querySelector("#author-total").textContent = data.t.toLocaleString("zh-CN");
    document.querySelector("#authored-book-total").textContent = data.b.toLocaleString("zh-CN");
    const requestedQuery = new URLSearchParams(location.search).get("q") || "";
    elements.query.value = requestedQuery;
    state.query = requestedQuery;
    filterAuthors();
  } catch (error) {
    console.error("作者名录加载失败", error);
    elements.grid.replaceChildren();
    elements.grid.hidden = true;
    elements.empty.hidden = false;
    elements.empty.querySelector("h3").textContent = "作者名录暂时无法展开";
    elements.empty.querySelector("p").textContent = "请稍后刷新页面再试。";
    elements.count.textContent = "名录加载失败";
  }
}

init();
