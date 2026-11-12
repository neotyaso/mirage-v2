// Mixamo アセットの自己テスト。GLB の存在・アニメーション・スキンを node だけで確認する。
// 見た目はヘッドレス Chrome で確認する前提で、ここでは差し替え時のリンク切れを防ぐ。

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = path.join(rootDir, "public", "models", "mixamo");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok - ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL - ${msg}`);
  }
}

const readGlbJson = (file) => {
  const buf = readFileSync(path.join(modelDir, file));
  assert(buf.readUInt32LE(0) === 0x46546c67, `${file} は GLB`);
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8"));
};

const clips = [
  "Idle.glb",
  "Walking.glb",
  "Robot_Hip_Hop_Dance.glb",
  "Breakdance_Uprock.glb",
  "Jazz_Dancing.glb",
  "House_Dancing.glb",
];

for (const file of clips) {
  assert(statSync(path.join(modelDir, file)).size > 1000, `${file} がある`);
  const json = readGlbJson(file);
  assert((json.animations?.length ?? 0) > 0, `${file} にアニメーションがある`);
}

const michelle = readGlbJson("Michelle.glb");
assert((michelle.skins?.length ?? 0) > 0, "Michelle.glb にスキンがある");
assert(
  (michelle.animations ?? []).some((clip) => clip.name === "SambaDance"),
  "Michelle.glb に SambaDance がある",
);

const src = readFileSync(path.join(rootDir, "src", "dance", "mixamo.ts"), "utf8");
for (const symbol of ["MIXAMO_CLIPS", "clipForStyle", "loadMixamoRig", "normalizeMixamoModel"]) {
  assert(src.includes(symbol), `mixamo.ts に ${symbol} がある`);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nmixamo assets: ok");
