// ダンス核（src/dance/dance.ts）の自己テスト。node だけで実行する。
// TS をその場で JS に変換し、拍・小節・style・moves の振る舞いを検証する。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const danceFile = path.join(rootDir, "src", "dance", "dance.ts");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok - ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL - ${msg}`);
  }
}

const src = readFileSync(danceFile, "utf8");
for (const text of ["sampleDance", "mergeDanceCue", "DANCE_MOVES", "DANCE_STYLES", "DancePose"]) {
  assert(src.includes(text), `dance.ts に ${text} がある`);
}

let ts;
try {
  ts = require("typescript");
} catch (e) {
  console.error(`FAIL - typescript が require できません: ${e.message}`);
  process.exit(1);
}
const outDir = path.join(os.tmpdir(), "mirage-dance-test");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "dance.test.mjs");
writeFileSync(
  outFile,
  ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const dance = await import(pathToFileURL(outFile).href);
const { DANCE_MOVES, DANCE_STYLES, defaultMoves, isDanceMove, isDanceStyle, mergeDanceCue, sampleDance } = dance;

assert(DANCE_STYLES.length === 4, "style は4種類");
assert(DANCE_MOVES.length === 8, "move は8種類");
assert(isDanceStyle("hype") && !isDanceStyle("edm"), "style の検証");
assert(isDanceMove("stepTouch") && !isDanceMove("moonwalk"), "move の検証");
assert(defaultMoves("hype").includes("armWave"), "style ごとの既定 move がある");

const baseCue = { style: "hype", energy: 0.7, moves: [] };
const merged = mergeDanceCue(baseCue, { energy: 2, moves: ["sway", "moonwalk", "spin"] });
assert(merged.style === "hype", "省略した style は維持");
assert(merged.energy === 1, "energy は 0.2..1 に丸める");
assert(merged.moves.length === 2 && merged.moves[1] === "spin", "不正な move は捨てる");
const changed = mergeDanceCue({ style: "hype", energy: 0.5, moves: ["spin"] }, { style: "cute" });
assert(changed.moves.join() === defaultMoves("cute").join(), "style だけ変えたら既定 move に切り替える");

const clock = { phase: 0.25, beat: 1, bar: 0, playing: true };
const quiet = sampleDance(clock, { style: "hype", energy: 0.2, moves: ["bounce"] });
const loud = sampleDance(clock, { style: "hype", energy: 1, moves: ["bounce"] });
assert(loud.rootY > quiet.rootY, "energy が高いほどバウンスが大きい");
assert(Number.isFinite(loud.rootY) && Number.isFinite(loud.rootX), "root は有限値");

const cute = sampleDance(clock, { style: "cute", energy: 1, moves: ["sway"] });
const cool = sampleDance(clock, { style: "cool", energy: 1, moves: ["sway"] });
assert(Math.abs(cute.bones.Hips[1]) > Math.abs(cool.bones.Hips[1]), "cute は cool より腰の振りが大きい");

const spinClock = { phase: 0, beat: 2, bar: 0, playing: true };
const spin = sampleDance(spinClock, { style: "hype", energy: 1, moves: ["spin"] });
assert(spin.rootYaw > 2.5, "spin は小節の半分で大きく回る");

const idle = sampleDance({ ...clock, playing: false }, baseCue);
assert(idle.rootY === 0 && idle.rootX === 0 && Object.keys(idle.bones).length === 0, "停止中は姿勢を変えない");

let finite = true;
for (const style of DANCE_STYLES) {
  for (const move of DANCE_MOVES) {
    for (let beat = 0; beat < 4; beat += 1) {
      const pose = sampleDance(
        { phase: 0.37, beat, bar: beat + 1, playing: true },
        { style, energy: 0.75, moves: [move] },
      );
      for (const v of [pose.rootX, pose.rootY, pose.rootYaw, pose.rootRoll, pose.accent]) {
        if (!Number.isFinite(v)) finite = false;
      }
      for (const offset of Object.values(pose.bones)) {
        if (offset.some((v) => !Number.isFinite(v))) finite = false;
      }
    }
  }
}
assert(finite, "全 style / move / beat で NaN が出ない");

console.log(failures === 0 ? "\nPASS dance" : `\nFAIL dance (${failures})`);
process.exit(failures === 0 ? 0 : 1);
