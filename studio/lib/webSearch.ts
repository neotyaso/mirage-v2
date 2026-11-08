// Web検索の薄いラッパ（D-017 / D-018）。
// TAVILY_API_KEY があれば Tavily（本文チャンクが返る）、無ければ ddgs（開発用フォールバック）。
// Mirage からは Studio の /api/web/search 経由で使う。外部公開しない前提。

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

const TAVILY_KEY = process.env.TAVILY_API_KEY;
const TAVILY_URL = "https://api.tavily.com/search";
const DDGS_URL = process.env.DDGS_API_URL ?? "http://127.0.0.1:4479";

const TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 100;
// 外部入力はそのままプロンプトへ入れない（P21 完了条件）
const MAX_TITLE = 200;
const MAX_SNIPPET = 1200;
const TIMEOUT_MS = 10000;

const cache = new Map<string, { at: number; results: WebResult[] }>();

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

async function searchTavily(query: string, maxResults: number): Promise<WebResult[]> {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TAVILY_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      search_depth: "basic", // basic=1クレジット。advanced は2で遅い
      max_results: maxResults,
      chunks_per_source: 2, // 抜粋ではなく本文チャンクが返る。増やすとプロンプトが膨らむ
      include_answer: false, // 答えを作るのは Gemini。二重LLMにしない
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}`);
  const data = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (data.results ?? []).map((r) => ({
    title: clip(r.title, MAX_TITLE),
    url: clip(r.url, 500),
    snippet: clip(r.content, MAX_SNIPPET),
  }));
}

async function searchDdgs(query: string, maxResults: number): Promise<WebResult[]> {
  const params = new URLSearchParams({
    query,
    max_results: String(maxResults),
    region: "jp-jp",
  });
  const url = `${DDGS_URL}/search/text?${params}`;
  // ddgs の auto は backend 次第で一時的に「No results found」を返す。1回だけ引き直す
  let res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ddgs ${res.status}`);

  const data = (await res.json()) as { results?: { title?: string; href?: string; body?: string }[] };
  return (data.results ?? []).map((r) => ({
    title: clip(r.title, MAX_TITLE),
    url: clip(r.href, 500),
    snippet: clip(r.body, MAX_SNIPPET),
  }));
}

export async function webSearch(query: string, maxResults = 5): Promise<WebResult[]> {
  const key = `${maxResults}|${query}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.results;

  const results = TAVILY_KEY
    ? await searchTavily(query, maxResults)
    : await searchDdgs(query, maxResults);

  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), results });
  return results;
}
