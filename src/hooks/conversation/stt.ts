// STT + VAD: Groq Whisper → ローカル stt_server.py フォールバック、無音・幻聴フィルタ

const GROQ_STT_URL = "/groq/openai/v1/audio/transcriptions";
const GROQ_STT_MODEL = "whisper-large-v3";
const LOCAL_STT_URL = "/stt/transcribe";

// VAD パラメータ（展示で調整）
// SPEECH_THRESHOLD/MIN_SPEECH_MSは元々18/300だったが、空調ノイズ等の環境音を「発話」と誤検知して
// Whisperに渡してしまい、無音・ノイズからのハルシネーション（「ご視聴ありがとうございました」等、
// 下記WHISPER_HALLUCINATION_PATTERNS参照）を誘発していたため引き上げた
export const SPEECH_THRESHOLD = 28;     // 音量しきい値（0〜255）。静かな環境なら下げる
export const SILENCE_DURATION_MS = 900;  // 何ms無音が続いたら「話し終わり」と判断するか
export const MIN_SPEECH_MS = 500;        // これ以下の発話は無視（咳・ノイズ除け）

// STT(Whisper)は無音・環境音だけの入力に対しても、学習データ(大半はYouTube)由来の
// もっともらしい定型文を返すことがある(ハルシネーション)。実際の来場者発話ではまず出ない
// フレーズだけを狙い撃ちでブロックする（「はい」「うん」等の短い相槌は普通の発話でも
// 起こりうるため、誤検知を減らすためあえて対象に含めない）
const WHISPER_HALLUCINATION_PATTERNS = [
  /ご視聴(ありがとうございました|ありがとうございます)/,
  /チャンネル登録/,
  /高評価.{0,6}(お願いします|よろしく)/,
  /最後まで(ご視聴|見て)/,
  /字幕視聴/,
  /次(の)?動画で(お会い|会い)しましょう/,
];

export function isWhisperHallucination(text: string): boolean {
  return WHISPER_HALLUCINATION_PATTERNS.some((re) => re.test(text));
}

// 「はい」「うん」等の短い相槌はWHISPER_HALLUCINATION_PATTERNSに含めていないため
// 単語ブラックリストでは弾けない。代わりにWhisper自身が付与する「無音らしさ」スコア
// (no_speech_prob、verbose_json形式でのみ取得可)を見て、実際は無音/環境音だったのに
// もっともらしい短い単語をでっち上げたケースだけを弾く（本物の相槌はスコアが低いので通る）。
const NO_SPEECH_PROB_THRESHOLD = 0.5;
const SHORT_TEXT_NO_SPEECH_THRESHOLD = 0.3;
const SHORT_TEXT_MAX_CHARS = 4; // 「はい」「うん」「はいはい」等を想定
interface WhisperVerboseSegment { no_speech_prob?: number }

export function isLikelyNoSpeech(text: string, segments: WhisperVerboseSegment[] | undefined): boolean {
  if (!segments || segments.length === 0) return false;
  const threshold = text.trim().length <= SHORT_TEXT_MAX_CHARS
    ? SHORT_TEXT_NO_SPEECH_THRESHOLD
    : NO_SPEECH_PROB_THRESHOLD;
  return segments.every((s) => (s.no_speech_prob ?? 0) >= threshold);
}

// 録音Blob → 発話テキスト。Groq Whisper → ローカルSTTへフォールバックし、
// 幻聪/no-speech をフィルタした結果を返す（空文字 = スキップ）
export async function transcribeBlob(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", blob, "audio.webm");
  form.append("model", GROQ_STT_MODEL);
  form.append("language", "ja");
  form.append("response_format", "verbose_json");

  let text = "";
  try {
    const res = await fetch(GROQ_STT_URL, { method: "POST", body: form });
    if (!res.ok) throw new Error(`groq stt ${res.status}`);
    const json = await res.json();
    text = json.text ?? "";
    if (text && isLikelyNoSpeech(text, json.segments)) {
      console.warn("Whisper no-speech filtered:", text, json.segments);
      text = "";
    }
  } catch {
    // Groqが失敗（ネット切断・障害等）→ ローカルSTTへフォールバック
    // (ローカルサーバーはno_speech_probを返さないため、この判定は対象外)
    const localForm = new FormData();
    localForm.append("audio", blob, "audio.webm");
    const res2 = await fetch(LOCAL_STT_URL, { method: "POST", body: localForm });
    text = (await res2.json()).text ?? "";
  }
  if (text && isWhisperHallucination(text)) {
    console.warn("Whisper hallucination filtered:", text);
    text = "";
  }
  return text;
}
