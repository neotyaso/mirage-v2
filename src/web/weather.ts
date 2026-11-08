// 天気は Studio の構造化API経由（D-018）。検索より速く、数値が確実。
// 接続先は vite.config.ts の /studio proxy。

const TIMEOUT_MS = 5000;

export interface WeatherReport {
  place: string;
  text: string;
  fetchedAt: string;
}

export async function getWeather(): Promise<WeatherReport> {
  const res = await fetch("/studio/api/web/weather", { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`weather ${res.status}`);
  return (await res.json()) as WeatherReport;
}
