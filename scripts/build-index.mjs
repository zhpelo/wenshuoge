import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";

const root = fileURLToPath(new URL("..", import.meta.url));
const booksDir = join(root, "ebookfiles");
const publicDir = join(root, "public");
const coversDir = join(publicDir, "covers");
const detailsDir = join(publicDir, "book-details-v2");
const metadataBatchesDir = join(root, "metadata", "batches");
const featuredIds = new Set(["1", "2", "6", "10", "22", "23", "25", "26", "28", "35", "37", "40"]);
const detailShardSize = 500;
const categoryOrder = [
  "经学礼制", "史地文献", "诸子哲思", "诗词文集", "小说", "戏曲",
  "医学养生", "科学技艺", "佛教典籍", "道教典籍", "语言文字",
  "艺术鉴藏", "外国文学", "近现代人文", "综合其他",
];

const categoryRules = [
  { name: "佛教典籍", subject: /佛教|佛经|佛学|禅宗|净土|密宗|经律论|大藏经/u, title: /佛|禅|菩萨|般若|法华|华严|金刚经|楞严|阿弥陀/u, text: /佛教|佛经|寺院|高僧/u },
  { name: "道教典籍", subject: /道教|丹道|修炼|房中术|北派五大家/u, title: /道藏|真经|仙|真人|丹经|悟真|太上|洞玄/u, text: /道教|道家修炼|内丹|外丹/u },
  { name: "医学养生", subject: /中医|医经|医案|医论|方书|本草|针灸|温热伤寒|妇科|幼科|养生|法医/u, title: /医|本草|脉经|伤寒|金匮|方论|药性|洗冤/u, text: /医学|医药|诊治|药物|疾病|法医学/u },
  { name: "戏曲", subject: /戏曲|戏剧|杂剧|传奇剧本|舞台剧|曲论|元曲/u, title: /杂剧|传奇|戏曲|剧本|院本|茶馆|牡丹亭|长生殿|桃花扇/u, text: /戏曲|剧本|舞台剧|杂剧/u },
  { name: "小说", subject: /小说|长篇|短篇|公案|武侠|话本|章回|白话/u, title: /演义|公案|奇案|小说|话本|醒世|警世|拍案|传奇$|外史$|红楼梦|西游记|水浒传|聊斋志异|搜神记/u, text: /长篇小说|短篇小说|公案小说|章回小说|话本/u },
  { name: "诗词文集", subject: /诗文|诗集|词集|文集|别集|辞赋|宋词|唐诗|诗论|词论|散文集|文学理论|文学创作|文章学|文论/u, title: /诗集|文集|别集|全集|诗钞|词钞|词集|诗话|词话|文钞/u, text: /诗文集|诗集|文集|文学作品/u },
  { name: "史地文献", subject: /史学|历史|地方志|地理|传记|奏议|公文档案|风俗志|名胜志|实录|纪事|游记/u, title: /史$|志$|纪$|实录|通鉴|纪事|传记|年谱|方舆|舆地|疆域|陵墓|游记/u, text: /历史地理|地方志|史学|历史著作|地理图志/u },
  { name: "经学礼制", subject: /经学|易学|礼学|儒经|四书|五经|注疏/u, title: /周易|易传|尚书|诗经|礼记|周礼|仪礼|春秋|论语|孟子|大学|中庸|孝经/u, text: /儒家经典|经学著作|礼制/u },
  { name: "语言文字", subject: /韵书|训诂|文字学|音韵|字书|语法|蒙学|启蒙读物/u, title: /字典|字汇|韵|说文|尔雅|训诂|广雅|切韵|三字经|千字文|弟子规|百家姓|幼学琼林|声律启蒙|增广贤文/u, text: /文字学|音韵学|训诂|语言文字/u },
  { name: "艺术鉴藏", subject: /书法|画论|金石学|音乐|鉴藏|篆刻|琴谱|棋谱/u, title: /书谱|画谱|琴谱|棋谱|印谱|墨谱|砚谱|画论|书论/u, text: /书法|绘画|音乐|艺术理论|收藏鉴赏/u },
  { name: "科学技艺", subject: /天文|数学|农书|植物志|科技|工艺|建筑|水利|历法/u, title: /算经|农政|天工|营造|历书|天文|水利/u, text: /科学技术|天文学|数学|农业技术|工艺技术/u },
  { name: "外国文学", subject: /外国文学|英国文学|法国文学|德国文学|俄国文学|美国文学|日本文学|奥地利文学/u, title: /傲慢与偏见|简爱|呼啸山庄|战争与和平|悲惨世界/u, text: /(?:英国|法国|德国|俄国|美国|日本|奥地利|意大利|西班牙)(?:作家|诗人|小说家).*?(?:小说|诗歌|文学)/u },
  { name: "近现代人文", subject: /近代|现代|民国|社会学|政治学|经济学|教育|外交/u, title: /民国|近代|现代|革命|外交/u, text: /近现代|民国时期|社会科学|政治思想/u },
  { name: "诸子哲思", subject: /哲学|儒学|理学|兵书|军事|兵法|战争理论|官箴|家训|语录|修养|修身|处世|格言|杂家|法家|墨家/u, title: /老子|庄子|荀子|韩非子|孙子兵法|墨子|列子|管子|家训|三十六计|六韬|三略|将苑|反经|罗织经|冰鉴|呻吟语|小窗幽记|围炉夜话|了凡四训|格言联璧/u, text: /哲学|思想著作|兵家|儒学|理学/u },
];

const eraPatterns = [
  ["近现代", /近现代|近代|现代|民国|清末|二十世纪|20世纪/u],
  ["清代", /清代|清朝|康熙|雍正|乾隆|嘉庆|道光|咸丰|同治|光绪|宣统/u],
  ["明代", /明代|明朝|洪武|永乐|宣德|正统|成化|弘治|正德|嘉靖|隆庆|万历|天启|崇祯/u],
  ["元代", /元代|元朝|至元|至正/u],
  ["宋代", /宋代|宋朝|北宋|南宋|辽代|金代/u],
  ["隋唐五代", /隋唐|隋代|唐代|唐朝|五代|后梁|后唐|后晋|后汉|后周/u],
  ["魏晋南北朝", /魏晋南北朝|魏晋|三国|曹魏|蜀汉|东吴|西晋|东晋|南朝|北朝/u],
  ["秦汉", /秦汉|秦代|秦朝|汉代|汉朝|西汉|东汉/u],
  ["先秦", /先秦|春秋|战国|西周|商代|商朝|夏代|夏朝/u],
];

async function loadEnhancements() {
  const merged = new Map();
  const inheritance = new Map();
  let filenames = [];
  try {
    filenames = (await readdir(metadataBatchesDir)).filter((name) => /^\d{3}\.json$/u.test(name)).sort();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  for (const filename of filenames) {
    const batch = JSON.parse(await readFile(join(metadataBatchesDir, filename), "utf8"));
    for (const [id, record] of Object.entries(batch.books ?? {})) {
      merged.set(id, { ...(merged.get(id) ?? {}), ...record, batch: batch.batch ?? filename.slice(0, 3) });
    }
    for (const [id, sourceId] of Object.entries(batch.inherits ?? {})) {
      inheritance.set(id, {
        sourceId: String(sourceId),
        batch: batch.batch ?? filename.slice(0, 3),
      });
    }
  }

  const resolveInheritance = (id, chain = []) => {
    if (merged.has(id)) return merged.get(id);
    const link = inheritance.get(id);
    if (!link) return null;
    if (chain.includes(id)) throw new Error(`书目资料继承形成循环：${[...chain, id].join(" -> ")}`);
    const source = merged.get(link.sourceId) ?? resolveInheritance(link.sourceId, [...chain, id]);
    if (!source) throw new Error(`书目 ${id} 继承的来源 ${link.sourceId} 不存在`);
    const inherited = {
      ...source,
      batch: link.batch,
      inheritedFrom: link.sourceId,
    };
    merged.set(id, inherited);
    return inherited;
  };

  for (const id of inheritance.keys()) {
    resolveInheritance(id);
  }
  return { records: merged, batches: filenames.length };
}

function categoryFor({ title, subjects, description }) {
  const subjectText = subjects.join(" ");
  const fullText = `${title} ${subjectText} ${description}`;
  let winner = { name: "综合其他", score: 0 };
  for (const rule of categoryRules) {
    const score = (rule.subject.test(subjectText) ? 8 : 0)
      + (rule.title.test(title) ? 9 : 0)
      + (rule.text.test(fullText) ? 2 : 0);
    if (score > winner.score) winner = { name: rule.name, score };
  }
  return winner.name;
}

function eraFor({ title, author, subjects, description, category }) {
  if (category === "外国文学") return "外国近代";
  const text = `${author} ${title} ${description.slice(0, 180)} ${subjects.join(" ")}`;
  let match = { era: "年代待考", position: Number.POSITIVE_INFINITY };
  for (const [era, pattern] of eraPatterns) {
    const position = text.search(pattern);
    if (position >= 0 && position < match.position) match = { era, position };
  }
  return match.era;
}

function cleanDescription(value) {
  if (!value) return "";
  return value.length > 800 ? `${value.slice(0, 798)}…` : value;
}

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/gu, " ")
    .trim();
}

function firstTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "iu"));
  return decodeXml(match?.[1]);
}

function allTags(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "giu"))]
    .map((match) => decodeXml(match[1]))
    .filter(Boolean);
}

function fallbackTitle(filename) {
  return basename(filename, extname(filename)).replace(/^文硕阁_/u, "");
}

function readMetadata(archive) {
  const entries = unzipSync(archive, {
    filter: ({ name, originalSize }) => {
      const normalized = name.toLowerCase();
      return normalized === "meta-inf/container.xml"
        || normalized.endsWith(".opf")
        || (originalSize < 5_000_000 && /(?:^|\/)(?:cover|coverimage)[^/]*\.(?:jpe?g|png)$/iu.test(name));
    },
  });
  const containerKey = Object.keys(entries).find((key) => key.toLowerCase() === "meta-inf/container.xml");
  if (!containerKey) return { entries, opf: "", opfPath: "" };

  const container = strFromU8(entries[containerKey]);
  const opfPath = container.match(/full-path=["']([^"']+)["']/iu)?.[1] ?? "";
  const opfKey = Object.keys(entries).find((key) => key === opfPath);
  return { entries, opf: opfKey ? strFromU8(entries[opfKey]) : "", opfPath };
}

async function extractFeaturedCover(id, metadata) {
  if (!featuredIds.has(id) || !metadata.opf) return null;
  const coverId = metadata.opf.match(/<meta\s+name=["']cover["']\s+content=["']([^"']+)["']/iu)?.[1];
  const coverItem = coverId
    ? metadata.opf.match(new RegExp(`<item[^>]+id=["']${coverId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["'][^>]+>`, "iu"))?.[0]
    : null;
  const href = coverItem?.match(/href=["']([^"']+)["']/iu)?.[1]
    ?? metadata.opf.match(/<item[^>]+(?:properties=["'][^"']*cover-image[^"']*["']|id=["']CoverImage["'])[^>]*href=["']([^"']+)["']/iu)?.[1];
  if (!href) return null;

  const base = metadata.opfPath.includes("/") ? metadata.opfPath.slice(0, metadata.opfPath.lastIndexOf("/") + 1) : "";
  const coverKey = Object.keys(metadata.entries).find((key) => key === `${base}${href}` || key.endsWith(`/${href}`));
  if (!coverKey) return null;

  const extension = extname(coverKey).toLowerCase() === ".png" ? "png" : "jpg";
  await writeFile(join(coversDir, `${id}.${extension}`), metadata.entries[coverKey]);
  return `/covers/${id}.${extension}`;
}

await mkdir(coversDir, { recursive: true });
await mkdir(detailsDir, { recursive: true });
const enhancements = await loadEnhancements();
const directories = (await readdir(booksDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
  .sort((a, b) => Number(a.name) - Number(b.name));

const books = [];
for (const [index, directory] of directories.entries()) {
  const folder = join(booksDir, directory.name);
  const filenames = (await readdir(folder)).filter((name) => /\.(?:epub|pdf)$/iu.test(name));
  if (!filenames.length) continue;

  const epubName = filenames.find((name) => name.toLowerCase().endsWith(".epub"));
  let metadata = { entries: {}, opf: "", opfPath: "" };
  if (epubName) {
    try {
      metadata = readMetadata(new Uint8Array(await readFile(join(folder, epubName))));
    } catch (error) {
      console.warn(`无法读取 EPUB 元数据：${directory.name} ${error instanceof Error ? error.message : ""}`);
    }
  }

  const paths = {};
  const sizes = {};
  for (const filename of filenames) {
    const format = extname(filename).slice(1).toLowerCase();
    paths[format] = `ebookfiles/${relative(booksDir, join(folder, filename)).split("\\").join("/")}`;
    sizes[format] = (await stat(join(folder, filename))).size;
  }

  const fallback = fallbackTitle(epubName ?? filenames[0]);
  const enhancement = enhancements.records.get(directory.name) ?? {};
  const originalSubjects = [...new Set(allTags(metadata.opf, "dc:subject"))].slice(0, 8);
  const description = cleanDescription(enhancement.description || firstTag(metadata.opf, "dc:description"));
  const title = enhancement.title || firstTag(metadata.opf, "dc:title") || fallback;
  const author = enhancement.author || firstTag(metadata.opf, "dc:creator") || "佚名";
  const inferredCategory = categoryFor({ title, subjects: originalSubjects, description });
  const category = enhancement.category || inferredCategory;
  const inferredEra = eraFor({ title, author, subjects: originalSubjects, description, category });
  const era = enhancement.era || inferredEra;
  const subjects = [...new Set([
    ...(enhancement.tags ?? []),
    ...originalSubjects,
    ...(originalSubjects.length ? [] : [category, era]),
  ].filter((value) => value && value !== "年代待考"))].slice(0, 10);
  books.push({
    id: directory.name,
    title,
    author,
    authorInfo: enhancement.authorInfo ?? "",
    subjects,
    description,
    category,
    era,
    period: enhancement.period || era,
    sources: Array.isArray(enhancement.sources) ? enhancement.sources : [],
    reviewed: enhancement.reviewed === true,
    batch: enhancement.batch ?? "",
    inheritedFrom: enhancement.inheritedFrom ?? "",
    formats: Object.keys(paths).sort(),
    paths,
    sizes,
    cover: await extractFeaturedCover(directory.name, metadata),
  });

  if ((index + 1) % 1000 === 0) process.stdout.write(`已整理 ${index + 1} 本\n`);
}

const payload = {
  g: new Date().toISOString(),
  t: books.length,
  r: books.filter((book) => book.reviewed).length,
  m: enhancements.batches,
  c: categoryOrder.map((category) => [category, books.filter((book) => book.category === category).length]),
  b: books.map((book) => {
    const formatMask = (book.formats.includes("epub") ? 1 : 0) | (book.formats.includes("pdf") ? 2 : 0);
    const primaryFormat = book.formats.includes("epub") ? "epub" : "pdf";
    const filename = basename(book.paths[primaryFormat], `.${primaryFormat}`);
    return [
      book.id, book.title, book.author, book.subjects, formatMask, filename,
      book.sizes.epub ?? 0, book.sizes.pdf ?? 0, book.category, book.era,
    ];
  }),
};

const serialized = JSON.stringify(payload);
await writeFile(join(publicDir, "books.json"), serialized);

const detailShards = new Map();
for (const book of books) {
  const shard = String(Math.floor(Number(book.id) / detailShardSize)).padStart(2, "0");
  if (!detailShards.has(shard)) detailShards.set(shard, {});
  detailShards.get(shard)[book.id] = [
    book.description,
    book.period,
    book.authorInfo,
    book.subjects,
    book.sources.map(({ title, url }) => [title, url]),
    book.reviewed ? 1 : 0,
    book.batch,
    book.inheritedFrom,
  ];
}
for (const [shard, details] of detailShards) {
  await writeFile(join(detailsDir, `${shard}.json`), JSON.stringify({ b: details }));
}

process.stdout.write(
  `索引完成：${books.length} 本，${enhancements.records.size} 本人工增强，${detailShards.size} 个详情分片，${Buffer.byteLength(serialized)} 字节\n`,
);
