import type { FaceExpression } from "../hooks/useFaceDetection";

export type Mood = "smile" | "surprised" | "confused" | "neutral";

/** 表情スコア→会話文脈に使うラベル。閾値は現場で外したらこの関数だけ調整する。 */
export function moodOf(expr: FaceExpression | undefined): Mood {
  if (!expr) return "neutral";
  if (expr.confused > 0.5) return "confused";
  if (expr.smile > 0.6) return "smile";
  if (expr.surprised > 0.5) return "surprised";
  return "neutral";
}

/** 文脈に書く日本語。neutral は注入しない（空文字）。 */
export const MOOD_JA: Record<Mood, string> = {
  smile: "笑顔",
  surprised: "驚いた様子",
  confused: "困惑気味",
  neutral: "",
};
