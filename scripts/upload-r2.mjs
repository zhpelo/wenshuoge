import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "ebookfiles");
const bucket = process.env.WENSHUOGE_R2_BUCKET || "wenshuoge";
const concurrency = Math.max(1, Math.min(12, Number(process.env.WENSHUOGE_UPLOAD_CONCURRENCY || 6)));

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(?:epub|pdf)$/iu.test(entry.name)) files.push(path);
  }
  return files;
}

function upload(file) {
  const key = `ebookfiles/${relative(source, file).split("\\").join("/")}`;
  const contentType = key.endsWith(".pdf") ? "application/pdf" : "application/epub+zip";
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, "node_modules/wrangler/bin/wrangler.js"), "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", contentType, "--remote"], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(key) : reject(new Error(`${key}: ${stderr.trim()}`)));
  });
}

const files = await walk(source);
let next = 0;
let finished = 0;
let failed = 0;
let uploadedBytes = 0;

async function worker() {
  while (next < files.length) {
    const file = files[next++];
    try {
      await upload(file);
      uploadedBytes += (await stat(file)).size;
    } catch (error) {
      failed += 1;
      console.error(error instanceof Error ? error.message : error);
    }
    finished += 1;
    if (finished % 100 === 0 || finished === files.length) {
      process.stdout.write(`已处理 ${finished}/${files.length}，失败 ${failed}，上传 ${(uploadedBytes / 1024 / 1024).toFixed(1)} MB\n`);
    }
  }
}

process.stdout.write(`开始上传 ${files.length} 个文件到 R2：${bucket}\n`);
await Promise.all(Array.from({ length: concurrency }, () => worker()));
if (failed) process.exitCode = 1;
