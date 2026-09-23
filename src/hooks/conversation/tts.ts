// ローカルTTSフォールバック: AivisSpeech (VOICEVOX互換 API) 合成
// 失敗時は呼び出し側が Web Speech API へフォールバックする。
// スピーカーIDは GET http://localhost:10101/speakers で確認して変更

const AIVIS_URL = "http://localhost:10101";
export const DEFAULT_SPEAKER_ID = 888753760;

// テキスト → PCM ArrayBuffer。失敗時はthrow（呼び出し側がWeb Speechへフォールバック）
export async function synthesizeAivis(text: string, speakerId: number): Promise<ArrayBuffer> {
  const qRes = await fetch(
    `${AIVIS_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
    { method: "POST" },
  );
  if (!qRes.ok) throw new Error("audio_query failed");
  const query = await qRes.json();
  const sRes = await fetch(`${AIVIS_URL}/synthesis?speaker=${speakerId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!sRes.ok) throw new Error("synthesis failed");
  return sRes.arrayBuffer();
}

// Web Speech API で読み上げる（Aivis不可時の保険）
export function speakWithWebSpeech(text: string): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 1.05;
    u.pitch = 1.2;
    const jp = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja"));
    if (jp) u.voice = jp;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}
