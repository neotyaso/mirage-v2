// ビートグリッドとセクション割りの自己テスト。show.ts を JS へ変換して純関数を直接叩く。

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(rootDir, "src", "dance", "show.ts"), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tempFile = path.join(tmpdir(), `mirage-show-${process.pid}-${Date.now()}.mjs`);
writeFileSync(tempFile, js);

const { TRACKS, sectionAtBar } = await import(pathToFileURL(tempFile).href);
rmSync(tempFile, { force: true });

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok - ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL - ${msg}`);
  }
}

const track = TRACKS.neon;
assert(track.bpm === 120, "BPM は 120");
assert(track.firstBeat === 0.987, "最初のダウンビートは 0.987s");
assert(track.bars === 60, "ループは 60 小節");

const cases = [
  [0, "intro"],
  [7, "intro"],
  [8, "drop"],
  [16, "drop"],
  [24, "break"],
  [32, "build"],
  [40, "drop"],
  [56, "outro"],
  [59, "outro"],
  [60, "intro"],
  [68, "drop"],
];
for (const [bar, id] of cases) {
  assert(sectionAtBar(track, bar).id === id, `bar ${bar} は ${id}`);
}

const starts = track.sections.map((section) => section.startBar);
assert(starts.every((value, index) => index === 0 || value > starts[index - 1]), "セクションは小節順");
assert(track.sections.every((section) => section.energy > 0 && section.energy <= 1), "energy は 0..1");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nsections: ok");
