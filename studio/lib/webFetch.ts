// 本文取得の薄いラッパ。crawl4ai の /md (localhost:11235) を叩く（D-017）。
// 公式 Docker サーバに移しても同じ形で使える。外部公開しない前提。

const CRAWL4AI_URL = process.env.CRAWL4AI_URL ?? "http://127.0.0.1:11235";
const TIMEOUT_MS = 15000;

export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(`${CRAWL4AI_URL}/md`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`crawl4ai ${res.status}`);

  const data: { markdown?: string } = await res.json();
  return typeof data.markdown === "string" ? data.markdown : "";
}
