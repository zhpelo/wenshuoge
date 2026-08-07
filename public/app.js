const PAGE_SIZE = 16;
const palettes = [
  ["#7b2e29", "#f0d29d"], ["#31524b", "#e9d5a6"], ["#3d4f61", "#ead3a6"],
  ["#82572e", "#f2ddb4"], ["#553a5a", "#ebd1aa"], ["#294956", "#e2c996"],
  ["#765143", "#f0d8af"], ["#465b3e", "#edd7a5"],
];

const state = { books: [], filtered: [], query: "", format: "all", visible: PAGE_SIZE };
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

function openDialog(book) {
  const dialog = elements.dialog;
  dialog.querySelector("h2").textContent = book.title;
  dialog.querySelector(".dialog-author").textContent = `著者 · ${book.author || "佚名"}`;
  dialog.querySelector(".dialog-description").textContent = book.description || "阁中暂未收录本书提要，可直接选取格式开始阅读。";
  const tags = dialog.querySelector(".dialog-tags");
  tags.replaceChildren(...book.subjects.slice(0, 6).map((subject) => {
    const span = document.createElement("span");
    span.textContent = subject;
    return span;
  }));
  makeActions(dialog.querySelector(".dialog-actions"), book);

  const cover = elements.template.content.querySelector(".book-object").cloneNode(true);
  applyCover(cover, book);
  dialog.querySelector(".dialog-cover-wrap").replaceChildren(cover);
  dialog.showModal();
}

function makeCard(book) {
  const card = elements.template.content.firstElementChild.cloneNode(true);
  applyCover(card.querySelector(".book-object"), book);
  card.querySelector("h3").textContent = book.title;
  card.querySelector(".book-author").textContent = `著者 · ${book.author || "佚名"}`;
  const tagContainer = card.querySelector(".book-tags");
  tagContainer.replaceChildren(...book.subjects.slice(0, 2).map((subject) => {
    const span = document.createElement("span");
    span.textContent = subject;
    return span;
  }));
  makeActions(card.querySelector(".book-actions"), book);
  card.querySelector(".book-object").addEventListener("click", () => openDialog(book));
  return card;
}

function render() {
  const visibleBooks = state.filtered.slice(0, state.visible);
  elements.grid.replaceChildren(...visibleBooks.map(makeCard));
  elements.grid.setAttribute("aria-busy", "false");
  elements.empty.hidden = state.filtered.length !== 0;
  elements.grid.hidden = state.filtered.length === 0;
  elements.more.hidden = state.visible >= state.filtered.length;
  elements.clear.hidden = !state.query && state.format === "all";

  const prefix = state.query ? `“${state.query}” 找到` : "阁中现藏";
  elements.count.innerHTML = `${prefix} <strong>${state.filtered.length.toLocaleString("zh-CN")}</strong> 册书`;
}

function normalize(value) {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s·《》「」『』，。！？、:：_-]+/gu, "");
}

function filterBooks({ reset = true } = {}) {
  const query = normalize(state.query);
  state.filtered = state.books.filter((book) => {
    if (state.format !== "all" && !book.formats.includes(state.format)) return false;
    if (!query) return true;
    const haystack = normalize([book.title, book.author, ...book.subjects].join(" "));
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

function searchFor(value, { scroll = false } = {}) {
  state.query = value.trim();
  elements.heroQuery.value = state.query;
  elements.catalogQuery.value = state.query;
  filterBooks();
  const url = new URL(location.href);
  state.query ? url.searchParams.set("q", state.query) : url.searchParams.delete("q");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  if (scroll) document.querySelector("#library").scrollIntoView({ behavior: "smooth" });
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
  document.querySelectorAll("[data-format]").forEach((item) => item.classList.toggle("active", item.dataset.format === "all"));
  searchFor("");
});
elements.more.addEventListener("click", () => { state.visible += PAGE_SIZE; render(); });
elements.dialog.querySelector(".dialog-close").addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) elements.dialog.close(); });
document.querySelector("#year").textContent = new Date().getFullYear();

async function init() {
  try {
    const response = await fetch("/books.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.books = data.b.map(([id, title, author, subjects, formatMask, filename, epubSize, pdfSize]) => {
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
      return { id, title, author, subjects, formats, paths, sizes, description: "" };
    });
    document.querySelector("#hero-total").textContent = data.t.toLocaleString("zh-CN");
    searchFor(new URLSearchParams(location.search).get("q") || "");
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
