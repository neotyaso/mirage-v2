// ステージ音源の自己テスト。MP3 の存在と show.ts の参照が外れていないかを確認する。

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(rootDir, "public", "audio", "dance-electro-120.mp3");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok - ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL - ${msg}`);
  }
}

assert(statSync(file).size > 1_000_000, "dance-electro-120.mp3 がある");

const show = readFileSync(path.join(rootDir, "src", "dance", "show.ts"), "utf8");
assert(show.includes('"/audio/dance-electro-120.mp3"'), "show.ts が音源を参照している");
assert(show.includes("bpm: 120"), "show.ts の BPM が 120");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\naudio assets: ok");
