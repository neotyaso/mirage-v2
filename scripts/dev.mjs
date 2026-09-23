#!/usr/bin/env node
/**
 * mirage one-shot launcher (Windows / M1 Mac 共通)。
 * vite(:5173) を起動する。AivisSpeech は外部アプリ前提のため警告のみ。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const VITE_URL = "http://localhost:5173/";
const AIVIS_URL = "http://localhost:10101/speakers";

// scripts/health-check.mjs と共有する唯一のURL定義。追加・変更はここだけに行う。
export const SERVICE_URLS = {
  vite: VITE_URL,
  aivis: AIVIS_URL,
};

export async function health(url, timeoutMs = 4000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log("mirage startup check");

  if (!(await health(AIVIS_URL))) console.log("[ -- ] AivisSpeechなし。起動は任意 (VOICEVOX等でも可)");
  else console.log("[ OK ] AivisSpeech 応答あり");

  if (await health(VITE_URL)) {
    console.log("[ OK ] vite 起動済み。再利用する");
    return;
  }
  console.log("starting vite (:5173)...");
  // npx.cmd直spawnはWindowsでEINVALになるため、nodeでvite binを直接叩く
  const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteBin)) {
    console.error("[ NG ] viteがない。`pnpm install` を実行");
    process.exit(1);
    return;
  }
  await new Promise((resolve) => {
    const vite = spawn(process.execPath, [viteBin], { cwd: root, stdio: "inherit", env: process.env });
    vite.on("exit", (code, signal) => {
      resolve();
      process.exitCode = code ?? (signal ? 130 : 0);
    });
    vite.on("error", (err) => {
      console.error(`[vite] 起動失敗: ${err.message}`);
      process.exitCode = 1;
      resolve();
    });
  });
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
