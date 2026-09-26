export interface CallContext {
  d: number | null;
  approaching: boolean;
  dwellS: number;
  yaw: number;
  smile: number;
  faceCount: number;
}

export interface CallDecision {
  shouldCall: boolean;
  text: string;
  emotion: string;
  action: "nod" | "tilt" | "beckon" | "none";
}

// 呼び込みセリフの唯一の源。App側のLINES/GROUP_LINESはここに一本化し、複数人時はgroupizeで寄せる。
export const CALLOUT_POOLS: Record<"far" | "mid" | "near", string[]> = {
  far: [
    "ねえねえ!そこのあなた、こっち来てよ〜!",
    "おーい!ちょっとだけ話していかない?",
  ],
  mid: [
    "あっ、いま目が合ったよね?ちょっとだけいい?",
    "ねえ、ちょっとだけ話していかない?",
  ],
  near: [
    "来てくれたんだ!嬉しいな",
    "わあ、近くまで来てくれてありがとう!",
  ],
};

/** 複数人向けに寄せる(「あなた」→「みんな」。なければ先頭に「みんな、」)。 */
export function groupize(text: string): string {
  if (text.includes("あなた")) return text.replace(/あなた/g, "みんな");
  if (text.includes("皆さん")) return text;
  return `みんな、${text}`;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function decideCall(c: CallContext): CallDecision {
  const approach = c.approaching ? 1 : 0;
  const dwell = Math.min(1, Math.max(0, Number.isFinite(c.dwellS) ? c.dwellS : 0) / 8);
  const yaw = Number.isFinite(c.yaw) ? c.yaw : 0;
  const yawTerm = 1 - Math.min(1, Math.abs(yaw) / 0.8);
  const smile = clamp01(c.smile);
  const score = 0.4 * approach + 0.25 * dwell + 0.2 * yawTerm + 0.15 * smile;
  const shouldCall = score >= 0.55;

  const d = c.d;
  const band: "far" | "mid" | "near" = d === null || d > 3 ? "far" : d > 1.4 ? "mid" : "near";
  const pool = CALLOUT_POOLS[band];
  const dwellS = Number.isFinite(c.dwellS) && c.dwellS > 0 ? c.dwellS : 0;
  const text = pool[Math.floor(dwellS) % pool.length];
  const emotion = band === "far" ? "callout" : "joy";
  const action: CallDecision["action"] = band === "near" ? "nod" : "beckon";
  return { shouldCall, text, emotion, action };
}
