// 検索・本文取得は Studio の API Route 経由（D-017）。
// ブラウザから外部サービスは叩かない。接続先は vite.config.ts の /studio proxy。

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const TIMEOUT_SEARCH_MS = 8000;
const TIMEOUT_FETCH_MS = 20000;

export async function webSearch(query: string): Promise<WebSearchResult[]> {
  const res = await fetch(`/studio/api/web/search?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(TIMEOUT_SEARCH_MS),
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data: { results?: WebSearchResult[] } = await res.json();
  return data.results ?? [];
}

export async function fetchPage(url: string): Promise<string> {
  const res = await fetch("/studio/api/web/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(TIMEOUT_FETCH_MS),
  });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const data: { markdown?: string } = await res.json();
  return data.markdown ?? "";
}
