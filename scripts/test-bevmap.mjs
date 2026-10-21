// BevMap（周囲マップ）の投影の自己テスト。node のみで実行可。
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
const compDir = path.join(rootDir, "src", "components");
const srcFile = path.join(compDir, "BevMap.tsx");
const roomFile = path.join(compDir, "roomLayout.ts");

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`ok - ${msg}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${msg}`);
  }
}

const opts = {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
};

const outDir = mkdtempSync(path.join(os.tmpdir(), "bevmap-"));
// 家具配置は相対importなので同じoutDirに .mjs として書き出す
writeFileSync(
  path.join(outDir, "roomLayout.mjs"),
  ts.transpileModule(readFileSync(roomFile, "utf8"), { ...opts, fileName: "roomLayout.ts" }).outputText
);

// react と jsx-runtime は呼ばないので落とす（tempから解決できないため）
const source = readFileSync(srcFile, "utf8")
  .replace(/^import .* from "react.*$/gm, "")
  .replace('from "./roomLayout"', 'from "./roomLayout.mjs"');
const js = ts
  .transpileModule(source, { ...opts, fileName: "BevMap.tsx" })
  .outputText.replace(/^import .*react\/jsx-runtime.*$/gm, "");

const outFile = path.join(outDir, "BevMap.mjs");
writeFileSync(outFile, js);
const { project } = await import(pathToFileURL(outFile).href);
const { ROOM } = await import(pathToFileURL(path.join(outDir, "roomLayout.mjs")).href);

const W = 400;
const H = 480;
const horizon = H * 0.4;

const p1 = project(0, 1);
const p2 = project(0, 2);
const p4 = project(0, 4);
const p8 = project(0, 8);

assert(p1.sx === W / 2, "正面は画面中央");
assert(p1.sy > horizon && p1.sy <= H, "1m先は地平線より下・画面内");
assert(p2.sy < p1.sy && p4.sy < p2.sy && p8.sy < p4.sy, "遠いほど上に描かれる");
assert(p8.sy > horizon, "8m先でも地平線より下");
assert(p1.pxPerM > p2.pxPerM && p2.pxPerM > p4.pxPerM, "遠いほど小さく描かれる");
assert(1.7 * p1.pxPerM < H, "1m先の身長が画面に収まる");

assert(project(1, 2).sx > W / 2 && project(-1, 2).sx < W / 2, "正のlatは右、負は左");

const near = project(0, 0.05);
const atNear = project(0, 0.6);
assert(near.sy === atNear.sy, "近すぎる相手は下端にクランプ");
const far = project(0, 99);
assert(far.sy === project(0, 8).sy, "遠すぎる相手は上限にクランプ");

const finite = [p1, p2, p4, p8, near, far].every(
  (p) => Number.isFinite(p.sx) && Number.isFinite(p.sy) && Number.isFinite(p.pxPerM)
);
assert(finite, "投影結果が有限値");

// 家具が画面内に収まる（仮配置の妥当性チェック）
const outside = ROOM.filter((f) => {
  for (const lat of [f.lat - f.w / 2, f.lat + f.w / 2]) {
    for (const d of [f.d - f.dep / 2, f.d + f.dep / 2]) {
      const p = project(lat, d);
      if (p.sx < 0 || p.sx > W || p.sy < horizon || p.sy > H) return true;
    }
  }
  return false;
});
assert(outside.length === 0, `家具が画面内に収まる (${outside.map((f) => f.kind).join(",") || "ok"})`);

if (failures > 0) {
  console.error(`\n${failures}件失敗`);
  process.exitCode = 1;
} else {
  console.log("\nすべて通過");
}
