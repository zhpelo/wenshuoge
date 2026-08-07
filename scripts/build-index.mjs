import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";

const root = fileURLToPath(new URL("..", import.meta.url));
const booksDir = join(root, "ebookfiles");
const publicDir = join(root, "public");
const coversDir = join(publicDir, "covers");
const featuredIds = new Set(["1", "2", "6", "10", "22", "23", "25", "26", "28", "35", "37", "40"]);

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
  const description = firstTag(metadata.opf, "dc:description");
  books.push({
    id: directory.name,
    title: firstTag(metadata.opf, "dc:title") || fallback,
    author: firstTag(metadata.opf, "dc:creator") || "佚名",
    subjects: [...new Set(allTags(metadata.opf, "dc:subject"))].slice(0, 8),
    description: description.length > 180 ? `${description.slice(0, 178)}…` : description,
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
  b: books.map((book) => {
    const formatMask = (book.formats.includes("epub") ? 1 : 0) | (book.formats.includes("pdf") ? 2 : 0);
    const primaryFormat = book.formats.includes("epub") ? "epub" : "pdf";
    const filename = basename(book.paths[primaryFormat], `.${primaryFormat}`);
    return [book.id, book.title, book.author, book.subjects, formatMask, filename, book.sizes.epub ?? 0, book.sizes.pdf ?? 0];
  }),
};

const serialized = JSON.stringify(payload);
await writeFile(join(publicDir, "books.json"), serialized);
process.stdout.write(`索引完成：${books.length} 本，${Buffer.byteLength(serialized)} 字节\n`);
