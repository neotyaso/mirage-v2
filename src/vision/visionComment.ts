// 「私、あなたが見えてるよ」演出: webカメラの1フレームをGemini visionモデルに投げ、
// 来場者の見た目に対する気の利いた一言を生成する。
//
// プライバシー: 画像はメモリ上で縮小してGeminiに送るだけで、保存も再送もしない。
// 送るのは小さいJPEG1枚のみ。実会場で使うならブース内にカメラ利用の掲示をするのが望ましい。
//
// キーは VITE_GEMINI_API_KEY のブラウザ直結（useGeminiLive と同じ。展示デモ割り切り）。
import { GoogleGenAI } from "@google/genai";

const VISION_MODEL = "gemini-3.5-flash";

// コメントできる要素が無い/人がちゃんと写っていない時にモデルに返させる合図。
// これが返ったら「言わない」（外した薄いコメントを無理に喋らせない＝確信度ガード）
const SKIP_TOKEN = "SKIP";

// カメラ映像の現在フレームを小さいJPEGのデータURLにする。
// 小さめ(既定240px)なのは送受信を軽くするためとプライバシー配慮の両方。
// videoがまだ再生準備前(readyState<2)やサイズ0なら撮れないのでnull。
function captureFrame(video: HTMLVideoElement, maxW = 240): string | null {
  if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
  const scale = Math.min(1, maxW / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.7);
}

const VISION_PROMPT = `あなたは展示ブースの陽気な呼び込みキャラ「レム」。目の前の来場者のカメラ画像を見て、その人の見た目の"いいところ"を見つけて一言だけ褒めて。服の色や柄・小物・髪型・持ち物・全体の雰囲気など、具体的なポイントを挙げて明るく褒める（イジったり欠点に触れたりは絶対にしない、褒めるだけ）。制約: タメ口でテンション高め・1文・15〜25文字・絵文字や記号や番号は付けない・セリフ本文だけ返す。人物がはっきり写っていない、または褒められる要素が全く見つからない場合のみ「${SKIP_TOKEN}」とだけ返す。`;

// サニタイズ用正規表現は使い回し（都度生成しない）
const QUOTE_EDGE_RE = /^["'「『]|["'」』]$/g;
const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
const SKIP_RE = new RegExp(SKIP_TOKEN, "i");
const MAX_VISION_COMMENT_LENGTH = 40;

// 引用符除去・絵文字除去・長さ棄却を単一化（順序・条件は従来通り）
function sanitizeVisionComment(raw: string): string | null {
  const text = raw.trim().replace(QUOTE_EDGE_RE, "").trim().replace(EMOJI_RE, "").trim();
  if (!text || SKIP_RE.test(text) || text.length > MAX_VISION_COMMENT_LENGTH) return null;
  return text;
}

/**
 * 来場者のカメラフレームから見た目コメントを1つ生成する。
 * コメントできない/失敗/確信度低い(SKIP)場合は null（呼び出し側は何も喋らせない）。
 */
export async function generateVisionComment(video: HTMLVideoElement | null): Promise<string | null> {
  if (!video) return null;
  const dataUrl = captureFrame(video);
  if (!dataUrl) return null;
  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (!apiKey) return null;
    const ai = new GoogleGenAI({ apiKey });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const res = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [{
        role: "user",
        parts: [
          { text: VISION_PROMPT },
          { inlineData: { mimeType: "image/jpeg", data: base64 } },
        ],
      }],
      config: {
        temperature: 0.9,
        maxOutputTokens: 60,
      },
    });
    const raw = res.text ?? "";
    return sanitizeVisionComment(raw);
  } catch {
    return null;
  }
}
