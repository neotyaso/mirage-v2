// 距離推定のMAE評価。依存なし。
// 手順:
//   1. 床に1/2/3mのテープを貼る
//   2. 各点に10秒立ち、デバッグHUDの dist を5〜10サンプル書き写す
//   3. CSV(1行 truth,estimate。ヘッダ可)にして `node scripts/eval-distance.mjs samples.csv`
// 出力: 全体MAE/RMSE/max＋真値ごとのMAE。顔幅式 vs IPD式のABに使う。
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/eval-distance.mjs <samples.csv>");
  process.exit(1);
}
const lines = readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
const rows = [];
for (const l of lines) {
  const [a, b] = l.split(",");
  const t = Number(a);
  const e = Number(b);
  if (!Number.isFinite(t) || !Number.isFinite(e)) continue; // ヘッダ行は飛ばす
  rows.push({ truth: t, estimate: e });
}
if (rows.length === 0) {
  console.error("有効な行がありません (truth,estimate のCSVが必要)");
  process.exit(1);
}
const errs = rows.map((r) => Math.abs(r.estimate - r.truth));
const mae = errs.reduce((s, e) => s + e, 0) / errs.length;
const rmse = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
const max = Math.max(...errs);
console.log(`n=${rows.length} MAE=${mae.toFixed(3)}m RMSE=${rmse.toFixed(3)}m max=${max.toFixed(3)}m`);
const byTruth = new Map();
for (const r of rows) {
  const k = r.truth.toFixed(1);
  if (!byTruth.has(k)) byTruth.set(k, []);
  byTruth.get(k).push(Math.abs(r.estimate - r.truth));
}
for (const [k, v] of [...byTruth.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  truth ${k}m: n=${v.length} MAE=${(v.reduce((s, e) => s + e, 0) / v.length).toFixed(3)}m`);
}
