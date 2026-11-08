#!/usr/bin/env node
// 展示後の振り返り用: tracking の JSONL からツール利用を集計する（P23 / D-019）。
// 検索された質問の上位を src/data/facility.ts に足せば、次回は検索せず即答できる。
//
// 使い方: node scripts/top-questions.mjs ~/Downloads/mirage-tracking-*.jsonl
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("使い方: node scripts/top-questions.mjs mirage-tracking-YYYY-MM-DD.jsonl");
  process.exit(1);
}

const rows = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

// ツール実行はすべて type: "web_search"。data.tool で種類を見分ける
const tools = rows.filter((r) => r.type === "web_search");
const by = (name) => tools.filter((r) => r.data?.tool === name);

const searches = by("web_search").filter((r) => r.data?.query);
const stats = new Map();
for (const s of searches) {
  const query = String(s.data.query).trim();
  const cur = stats.get(query) ?? { count: 0, ok: 0, ms: 0 };
  cur.count += 1;
  if (s.data.ok) cur.ok += 1;
  cur.ms += Number(s.data.ms ?? 0);
  stats.set(query, cur);
}

const sorted = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
const weather = by("get_weather");
const fetches = by("fetch_page");

console.log(`ツール実行: ${tools.length}件`);
console.log(`  検索 ${searches.length}件 / 天気 ${weather.length}件 / 本文 ${fetches.length}件\n`);

console.log(`検索された質問: ${searches.length}件（ユニーク ${sorted.length}件）`);
for (const [query, s] of sorted.slice(0, 20)) {
  const avg = Math.round(s.ms / s.count);
  console.log(`  ${String(s.count).padStart(3)}回  ${String(avg).padStart(5)}ms  OK ${s.ok}/${s.count}  ${query}`);
}

const failed = sorted.filter(([, s]) => s.ok < s.count);
if (failed.length > 0) {
  console.log("\n失敗した検索（施設情報に足すか、答え方を変える候補）:");
  for (const [query] of failed) console.log(`  - ${query}`);
}

if (searches.length > 0) {
  console.log("\n→ 上位の質問を src/data/facility.ts に足すと、次回は検索せず即答できる。");
}
