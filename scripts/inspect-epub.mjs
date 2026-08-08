import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { posix } from "node:path";
import { strFromU8, unzipSync } from "fflate";

const ids = process.argv.slice(2);
if (!ids.length) {
  process.stderr.write("用法：node scripts/inspect-epub.mjs <书目编号> [...]\n");
  process.exit(1);
}

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)));
}

function textFromHtml(html = "") {
  return decodeXml(html)
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tagValue(xml, tag) {
  return textFromHtml(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "iu"))?.[1]);
}

function attributes(tag = "") {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/gu)].map((match) => [match[1], match[2]]),
  );
}

function archivePath(baseFile, href) {
  const cleanHref = decodeURIComponent(String(href ?? "").split("#")[0]);
  return posix.normalize(posix.join(posix.dirname(baseFile), cleanHref));
}

function headings(html) {
  const values = [...html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/giu)]
    .map((match) => textFromHtml(match[1]))
    .filter(Boolean);
  if (values.length) return values;
  const title = tagValue(html, "title");
  return title ? [title] : [];
}

function tocEntries(entries, opf, opfPath, manifest) {
  const nav = [...manifest.values()].find((item) => item.properties?.split(/\s+/u).includes("nav"));
  if (nav) {
    const html = strFromU8(entries[archivePath(opfPath, nav.href)] ?? new Uint8Array());
    const navBlock = html.match(/<nav\b[^>]*(?:epub:type=["']toc["']|role=["']doc-toc["'])[^>]*>([\s\S]*?)<\/nav>/iu)?.[1] ?? html;
    return [...navBlock.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)]
      .map((match) => ({ title: textFromHtml(match[2]), href: match[1] }))
      .filter((item) => item.title);
  }

  const tocId = attributes(opf.match(/<spine\b[^>]*>/iu)?.[0]).toc;
  const ncx = manifest.get(tocId) ?? [...manifest.values()].find((item) => /ncx/iu.test(item.mediaType ?? ""));
  if (!ncx) return [];
  const xml = strFromU8(entries[archivePath(opfPath, ncx.href)] ?? new Uint8Array());
  return [...xml.matchAll(/<navPoint\b[\s\S]*?<navLabel\b[^>]*>[\s\S]*?<text\b[^>]*>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*src=["']([^"']+)["'][^>]*\/?>(?:[\s\S]*?<\/navPoint>)?/giu)]
    .map((match) => ({ title: textFromHtml(match[1]), href: match[2] }))
    .filter((item) => item.title);
}

for (const id of ids) {
  const folder = new URL(`../ebookfiles/${id}/`, import.meta.url);
  const epubName = (await readdir(folder)).find((name) => name.toLowerCase().endsWith(".epub"));
  if (!epubName) {
    process.stdout.write(`${JSON.stringify({ id, error: "没有 EPUB 文件" })}\n`);
    continue;
  }

  const archive = unzipSync(new Uint8Array(await readFile(new URL(epubName, folder))));
  const containerKey = Object.keys(archive).find((key) => key.toLowerCase() === "meta-inf/container.xml");
  const container = containerKey ? strFromU8(archive[containerKey]) : "";
  const opfPath = container.match(/full-path=["']([^"']+)["']/iu)?.[1] ?? "";
  const opf = opfPath && archive[opfPath] ? strFromU8(archive[opfPath]) : "";
  const manifest = new Map(
    [...opf.matchAll(/<item\b[^>]*>/giu)].map((match) => {
      const item = attributes(match[0]);
      return [item.id, { href: item.href, mediaType: item["media-type"], properties: item.properties }];
    }).filter(([, item]) => item.href),
  );
  const spineIds = [...opf.matchAll(/<itemref\b[^>]*>/giu)].map((match) => attributes(match[0]).idref).filter(Boolean);
  const spine = spineIds.map((spineId, index) => {
    const item = manifest.get(spineId);
    const path = item ? archivePath(opfPath, item.href) : "";
    const html = path && archive[path] ? strFromU8(archive[path]) : "";
    const text = textFromHtml(html);
    const normalized = text.replace(/\s+/gu, "");
    return {
      index: index + 1,
      path,
      headings: headings(html).slice(0, 4),
      chars: text.length,
      hash: normalized ? createHash("sha256").update(normalized).digest("hex") : "",
    };
  });
  const duplicateGroups = [...Map.groupBy(spine.filter((item) => item.hash && item.chars > 100), (item) => item.hash).values()]
    .filter((group) => group.length > 1)
    .map((group) => group.map(({ index, path, headings: chapterHeadings, chars }) => ({ index, path, headings: chapterHeadings, chars })));

  process.stdout.write(`${JSON.stringify({
    id,
    file: epubName,
    metadata: {
      title: tagValue(opf, "dc:title"),
      creator: tagValue(opf, "dc:creator"),
      date: tagValue(opf, "dc:date"),
      description: tagValue(opf, "dc:description"),
      subjects: [...opf.matchAll(/<dc:subject(?:\s[^>]*)?>([\s\S]*?)<\/dc:subject>/giu)].map((match) => textFromHtml(match[1])),
    },
    toc: tocEntries(archive, opf, opfPath, manifest),
    spine: spine.map(({ hash: _hash, ...item }) => item),
    spineCount: spine.length,
    textChars: spine.reduce((sum, item) => sum + item.chars, 0),
    duplicateGroups,
  })}\n`);
}
