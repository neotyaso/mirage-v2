// Open-Meteo の天気（キー不要・無料）。D-018
// 天気は検索と相性が悪い（数値がJS描画・抜粋が宣伝文）ので、構造化APIから直接取る。
// 10分キャッシュ: 質問のたびに叩かず、鮮度は保つ。

export interface WeatherReport {
  place: string;
  text: string;
  fetchedAt: string;
}

const LAT = process.env.FACILITY_LAT ?? "35.4437";
const LON = process.env.FACILITY_LON ?? "139.6380";
const PLACE = process.env.FACILITY_PLACE ?? "横浜";
const TTL_MS = 10 * 60 * 1000;

// WMO weather code → 日本語（Open-Meteo の仕様）
const CODES: Record<number, string> = {
  0: "快晴", 1: "晴れ", 2: "晴れ時々くもり", 3: "くもり",
  45: "霧", 48: "霧",
  51: "弱い霧雨", 53: "霧雨", 55: "強い霧雨",
  56: "着氷性の霧雨", 57: "着氷性の霧雨",
  61: "弱い雨", 63: "雨", 65: "強い雨",
  66: "着氷性の雨", 67: "着氷性の雨",
  71: "弱い雪", 73: "雪", 75: "強い雪", 77: "霧雪",
  80: "にわか雨", 81: "にわか雨", 82: "激しいにわか雨",
  85: "にわか雪", 86: "にわか雪",
  95: "雷雨", 96: "雷雨（ひょう）", 99: "雷雨（ひょう）",
};

interface Cached {
  at: number;
  report: WeatherReport;
}

let cache: Cached | null = null;
let inflight: Promise<WeatherReport> | null = null;

const md = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

async function fetchWeather(): Promise<WeatherReport> {
  const params = new URLSearchParams({
    latitude: LAT,
    longitude: LON,
    current: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Asia/Tokyo",
    forecast_days: "2",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);

  const data = (await res.json()) as {
    current: { time: string; temperature_2m: number; weather_code: number };
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: (number | null)[];
    };
  };

  const label = (code: number) => CODES[code] ?? "不明";
  const dayBody = (i: number) => {
    const pop = data.daily.precipitation_probability_max[i];
    return (
      `${label(data.daily.weather_code[i])}` +
      ` 最高${Math.round(data.daily.temperature_2m_max[i])}℃` +
      ` 最低${Math.round(data.daily.temperature_2m_min[i])}℃` +
      (pop === null || pop === undefined ? "" : ` 降水確率${pop}%`)
    );
  };

  const text =
    `${PLACE}の天気（${data.current.time.replace("T", " ")} 時点）\n` +
    `現在: ${Math.round(data.current.temperature_2m)}℃ ${label(data.current.weather_code)}\n` +
    `今日(${md(data.daily.time[0])}): ${dayBody(0)}\n` +
    `明日(${md(data.daily.time[1])}): ${dayBody(1)}`;

  return { place: PLACE, text, fetchedAt: new Date().toISOString() };
}

export async function getWeather(): Promise<WeatherReport> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.report;
  if (inflight) return inflight;
  inflight = fetchWeather()
    .then((report) => {
      cache = { at: Date.now(), report };
      return report;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
