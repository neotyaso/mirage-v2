// TTS: AivisSpeech (VOICEVOX互換 API) 合成。再生(AudioContext)は useConversation 側

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
