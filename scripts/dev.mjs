#!/usr/bin/env node
/**
 * mirage one-shot launcher (Windows / M1 Mac 共通)。
 * 1コマンドで、MIRAGE Next.js(:3000) / 検索 API(:4479) / 本文取得(:11235) を起動する。
 * すでに動いているものは再利用する。Ollama（:11434）は任意。
 */
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const OLLAMA_URL = "http://localhost:11434/api/tags";
const APP_URL = "http://localhost:3000/";
const DDGS_URL = "http://127.0.0.1:4479/health";
const CRAWL_URL = "http://127.0.0.1:11235/openapi.json";

// scripts/health-check.mjs と共有する唯一のURL定義。追加・変更はここだけに行う。
export const SERVICE_URLS = {
  app: APP_URL,
  ollama: OLLAMA_URL,
  ddgs: DDGS_URL,
  crawl4ai: CRAWL_URL,
};

export async function health(url, timeoutMs = 4000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

// 子プロセスのログに [studio] のような接頭辞を付ける（4つ同時に吐くため）
const children = [];

function startService(name, command, args, cwd = root) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `[${name}] `;
  for (const [stream, out] of [
    [child.stdout, console.log],
    [child.stderr, console.error],
  ]) {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) out(prefix + line);
    });
  }
  child.on("error", (err) => console.error(`${prefix}起動失敗: ${err.message}`));
  children.push(child);
  return child;
}

function stopServices() {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}
process.on("exit", stopServices);

// 起動直後は応答できないので、待ってから次の工程へ進む
async function waitFor(url, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await health(url, 1000)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function ensure(name, url, start) {
  if (await health(url)) {
    console.log(`[ OK ] ${name} 起動済み。再利用する`);
    return;
  }
  console.log(`starting ${name} ...`);
  start();
  if (!(await waitFor(url))) console.error(`[ NG ] ${name} が応答しない（ログを確認）`);
}

async function main() {
  console.log("mirage startup check");

  if (!(await health(OLLAMA_URL))) console.log("[ -- ] Ollamaなし。フォールバック LLM は無効（Gemini Live のみ）");
  else console.log("[ OK ] Ollama 応答あり");

  await ensure("MIRAGE (:3000)", APP_URL, () =>
    startService(
      "mirage",
      process.execPath,
      [path.join(root, "studio", "node_modules", "next", "dist", "bin", "next"), "dev"],
      path.join(root, "studio"),
    ),
  );
  await ensure("検索 API (:4479)", DDGS_URL, () =>
    startService("ddgs", "uvx", ["--from", "ddgs[api]", "ddgs", "api", "--host", "127.0.0.1", "--port", "4479"]),
  );
  await ensure("本文取得 (:11235)", CRAWL_URL, () =>
    startService("crawl", "uv", [
      "run",
      "--python",
      "3.12",
      "--with",
      "crawl4ai",
      "--with",
      "fastapi",
      "--with",
      "uvicorn",
      path.join(root, "scripts", "crawl-server.py"),
    ]),
  );

  // ddgs は最初の1回だけ backend 探索で 6 秒以上かかることがある。来場者を待たせないよう温めておく
  if (await health(DDGS_URL)) {
    void fetch(`${DDGS_URL.replace("/health", "")}/search/text?query=warmup&max_results=1`).catch(() => {});
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await main();
  } catch (err) {
    console.error(`[ NG ] ${err.message}`);
    process.exit(1);
  }
}
