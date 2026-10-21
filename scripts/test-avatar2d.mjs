// Avatar2Dの状態更新（純関数）の自己テスト。node のみで実行可。
// 方針: scripts/test-tracking.mjs と同じく、node_modules の typescript で
// src/components/avatar2d.ts の実物をその場で JS にして import する。
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcFile = path.join(rootDir, "src", "components", "avatar2dState.ts");

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`ok - ${msg}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${msg}`);
  }
}

const js = ts.transpileModule(readFileSync(srcFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: "avatar2d.ts",
}).outputText;

const outDir = mkdtempSync(path.join(os.tmpdir(), "avatar2d-"));
const outFile = path.join(outDir, "avatar2d.mjs");
writeFileSync(outFile, js);
const { createAvatar2DState, stepAvatar2D } = await import(pathToFileURL(outFile).href);

const IDLE = { speaking: false, volume: 0, time: 0, face: null, eye: null };

function run(steps, input, state = createAvatar2DState(), dt = 0.05) {
  let last = { state, blink: 0 };
  for (let i = 0; i < steps; i += 1) last = stepAvatar2D(last.state, dt, { ...input, time: i * dt });
  return last;
}

// 1. まだまばたきの時刻でなければ開いている
{
  const s = { ...createAvatar2DState(), nextBlink: 10 };
  const r = stepAvatar2D(s, 0.05, IDLE);
  assert(r.blink === 0, "まばたき前は目が開いている");
}

// 2. まばたき窓の途中では閉じかけている
{
  const s = { ...createAvatar2DState(), blinkClock: 0, nextBlink: 0 };
  const r = stepAvatar2D(s, 0.05, IDLE);
  assert(r.blink > 0.3 && r.blink <= 1, `まばたき中は目が閉じる (blink=${r.blink.toFixed(3)})`);
}

// 3. 窓を過ぎたら開いて、次回時刻が先へ進む
{
  const s = { ...createAvatar2DState(), blinkClock: 0, nextBlink: -0.2 };
  const r = stepAvatar2D(s, 0.05, IDLE);
  assert(r.blink === 0, "まばたき後は目が開く");
  assert(r.state.nextBlink > r.state.blinkClock, "次のまばたき時刻が先へ進む");
}

// 4. 発話＋音量で口が開く
{
  const r = run(5, { ...IDLE, speaking: true, volume: 0.5 });
  assert(r.state.mouth > 0.3, `発話中は口が開く (mouth=${r.state.mouth.toFixed(3)})`);
}

// 5. 無音なら口が閉じる
{
  const speaking = run(5, { ...IDLE, speaking: true, volume: 0.5 });
  const silent = run(30, { ...IDLE, speaking: false }, speaking.state);
  assert(silent.state.mouth < 0.05, `無音で口が閉じる (mouth=${silent.state.mouth.toFixed(3)})`);
}

// 6. 口は常に0..1に収まる
{
  const r = run(60, { ...IDLE, speaking: true, volume: 3 });
  assert(r.state.mouth >= 0 && r.state.mouth <= 1, "口の開きは0..1に収まる");
}

// 7. 顔が右 → 画面は左へ視差、視線は左向き
{
  const r = run(60, { ...IDLE, face: { x: 1, y: 0.5 } });
  assert(r.state.parX < -1, `顔が右で画面が左へ (parX=${r.state.parX.toFixed(2)})`);
  assert(r.state.gazeX < -1, `顔が右で視線が左へ (gazeX=${r.state.gazeX.toFixed(2)})`);
}

// 8. 顔が上 → 画面は下へ、視線は上向き（画面yは下が正）
{
  const r = run(60, { ...IDLE, face: { x: 0.5, y: 0 }, eye: { x: 0.5, y: 0 } });
  assert(r.state.parY > 1, `顔が上で画面が下へ (parY=${r.state.parY.toFixed(2)})`);
  assert(r.state.gazeY < -1, `顔が上で視線が上へ (gazeY=${r.state.gazeY.toFixed(2)})`);
}

// 9. 顔なしでも有限値のまま
{
  const r = run(30, IDLE);
  const finite = Object.values(r.state).every((v) => Number.isFinite(v));
  assert(finite, "顔なしでも状態が壊れない");
  assert(Math.abs(r.state.parX) < 0.01 && Math.abs(r.state.gazeX) < 0.01, "顔なしでは中央へ戻る");
}

// 10. 巨大なdtでも暴れない（タブ復帰時）
{
  const r = stepAvatar2D(createAvatar2DState(), 5, { ...IDLE, speaking: true, volume: 1 });
  assert(Number.isFinite(r.state.mouth) && r.state.mouth <= 1, "dtをクランプして暴れない");
}

if (failures > 0) {
  console.error(`\n${failures}件失敗`);
  process.exitCode = 1;
} else {
  console.log("\nすべて通過");
}
