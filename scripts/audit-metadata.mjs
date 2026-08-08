import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const batchesDir = join(root, "metadata", "batches");
const booksDir = join(root, "ebookfiles");
const publicDir = join(root, "public");
const requiredTextFields = ["author", "authorInfo", "period", "era", "category", "description"];
const failures = [];
const records = new Map();
const inheritance = new Map();
const ownership = new Map();
const filenames = (await readdir(batchesDir))
  .filter((name) => /^\d{3}\.json$/u.test(name))
  .sort();

function fail(message) {
  failures.push(message);
}

async function requireBookDirectory(id, owner) {
  try {
    await access(join(booksDir, id));
  } catch {
    fail(`${owner} 引用的书目 ${id} 不存在于 ebookfiles`);
  }
}

for (const filename of filenames) {
  const filepath = join(batchesDir, filename);
  const data = JSON.parse(await readFile(filepath, "utf8"));
  const expectedBatch = filename.slice(0, 3);
  if (data.batch !== expectedBatch) fail(`${filename} 的 batch 应为 ${expectedBatch}`);

  for (const [id, record] of Object.entries(data.books ?? {})) {
    if (ownership.has(id)) fail(`书目 ${id} 同时出现在 ${ownership.get(id)} 与 ${filename}`);
    ownership.set(id, filename);
    records.set(id, { ...record, batch: data.batch });
    await requireBookDirectory(id, filename);

    for (const field of requiredTextFields) {
      if (!String(record[field] ?? "").trim()) fail(`${filename} 书目 ${id} 缺少 ${field}`);
    }
    if (!Array.isArray(record.tags) || record.tags.length < 3) fail(`${filename} 书目 ${id} 至少需要 3 个标签`);
    if (!Array.isArray(record.sources) || record.sources.length < 1) {
      fail(`${filename} 书目 ${id} 至少需要 1 个来源`);
    } else {
      for (const source of record.sources) {
        if (!String(source?.title ?? "").trim()) fail(`${filename} 书目 ${id} 存在无标题来源`);
        if (!/^https:\/\//u.test(String(source?.url ?? ""))) fail(`${filename} 书目 ${id} 的来源必须使用 HTTPS`);
      }
    }
    if (record.reviewed !== true) fail(`${filename} 书目 ${id} 未标记 reviewed: true`);
  }

  for (const [id, sourceIdValue] of Object.entries(data.inherits ?? {})) {
    const sourceId = String(sourceIdValue);
    if (ownership.has(id)) fail(`书目 ${id} 同时定义内容和继承关系（${filename}）`);
    ownership.set(id, filename);
    inheritance.set(id, { sourceId, batch: data.batch, filename });
    await requireBookDirectory(id, filename);
  }
}

function resolve(id, chain = []) {
  if (records.has(id)) return records.get(id);
  const link = inheritance.get(id);
  if (!link) return null;
  if (chain.includes(id)) {
    fail(`书目继承形成循环：${[...chain, id].join(" -> ")}`);
    return null;
  }
  const source = resolve(link.sourceId, [...chain, id]);
  if (!source) {
    fail(`${link.filename} 书目 ${id} 的继承来源 ${link.sourceId} 不存在`);
    return null;
  }
  const inherited = { ...source, batch: link.batch, inheritedFrom: link.sourceId };
  records.set(id, inherited);
  return inherited;
}

for (const id of inheritance.keys()) resolve(id);

const index = JSON.parse(await readFile(join(publicDir, "books.json"), "utf8"));
if (index.m !== filenames.length) fail(`公开索引批次数为 ${index.m}，应为 ${filenames.length}`);
if (index.r !== records.size) fail(`公开索引核验数为 ${index.r}，应为 ${records.size}`);

const shardCache = new Map();
async function detailFor(id) {
  const shard = String(Math.floor(Number(id) / 500)).padStart(2, "0");
  if (!shardCache.has(shard)) {
    shardCache.set(shard, JSON.parse(await readFile(join(publicDir, "book-details-v2", `${shard}.json`), "utf8")).b);
  }
  return shardCache.get(shard)[id];
}

for (const [id, record] of records) {
  const detail = await detailFor(id);
  if (!detail) {
    fail(`公开详情缺少书目 ${id}`);
    continue;
  }
  if (detail[5] !== 1) fail(`公开详情书目 ${id} 未标记已核验`);
  if (detail[6] !== record.batch) fail(`公开详情书目 ${id} 的批次 ${detail[6]} 与 ${record.batch} 不一致`);
  if ((detail[7] ?? "") !== (record.inheritedFrom ?? "")) fail(`公开详情书目 ${id} 的继承来源不一致`);
}

const missing = { authorInfo: 0, sources: 0, period: 0, unknownAuthor: 0 };
for (const row of index.b) {
  const detail = await detailFor(row[0]);
  if (!detail?.[2]) missing.authorInfo += 1;
  if (!detail?.[4]?.length) missing.sources += 1;
  if (!detail?.[1] || detail[1] === "年代待考") missing.period += 1;
  if (row[2] === "佚名") missing.unknownAuthor += 1;
}

const summary = {
  total: index.t,
  batches: filenames.length,
  reviewed: records.size,
  direct: records.size - inheritance.size,
  inherited: inheritance.size,
  remaining: index.t - records.size,
  missing,
  failures: failures.length,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failures.length) {
  for (const message of failures) process.stderr.write(`- ${message}\n`);
  process.exitCode = 1;
}
