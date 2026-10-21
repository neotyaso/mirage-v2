// SurroundView の透視投影の自己テスト。node のみで実行可。
// 方針: scripts/test-avatar2d.mjs と同じく、node_modules の typescript で
// 実物の .tsx をその場で JS にして import する（描画側は呼ばない）。
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcFile = path.join(rootDir, "src", "components", "SurroundView.tsx");

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`ok - ${msg}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${msg}`);
  }
}

// react を解決させないため、import 行は落として project() だけ抜き出す
const source = readFileSync(srcFile, "utf8").replace(/^import .*$/gm, "");
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
  fileName: "SurroundView.tsx",
}).outputText;

const outDir = mkdtempSync(path.join(os.tmpdir(), "surround-"));
const outFile = path.join(outDir, "surround.mjs");
// JSXランタイムのimportは呼ばないので落とす（tempから解決できないため）
writeFileSync(outFile, js.replace(/^import .*react\/jsx-runtime.*$/gm, ""));
const { project } = await import(pathToFileURL(outFile).href);

const W = 1920;
const H = 1080;
const horizon = H * 0.42;

const p1 = project(0.5, 1, W, H);
const p2 = project(0.5, 2, W, H);
const p4 = project(0.5, 4, W, H);
const p8 = project(0.5, 8, W, H);

assert(p1.sx === W / 2, "中央の顔は画面中央に出る");
assert(p1.sy > horizon && p1.sy <= H, "1m先は地平線より下・画面内");
assert(p2.sy < p1.sy && p4.sy < p2.sy && p8.sy < p4.sy, "遠いほど上に描かれる");
assert(p8.sy > horizon, "8m先でも地平線より下");
assert(p1.h > p2.h && p2.h > p4.h && p8.h > 0, "遠いほど小さく描かれる");
assert(p1.h <= H * 0.9 + 1e-9, "人型の高さは画面の9割を超えない");

const left = project(0, 2, W, H);
const right = project(1, 2, W, H);
assert(left.sx > W / 2 && right.sx < W / 2, "左右は鏡像の向き（旧BevMapと同じ）");
assert(left.sx <= W && right.sx >= 0, "画面外へはみ出さない");

const near = project(0.5, 0.05, W, H);
const near2 = project(0.5, 0.7, W, H);
assert(near.sy === near2.sy, "近すぎる相手は下端にクランプされる");

const far = project(0.5, 99, W, H);
assert(Number.isFinite(far.sy) && far.sy > horizon, "遠すぎる相手も有限値");

if (failures > 0) {
  console.error(`\n${failures}件失敗`);
  process.exitCode = 1;
} else {
  console.log("\nすべて通過");
}
