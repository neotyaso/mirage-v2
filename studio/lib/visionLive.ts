// Mirage から届く最新のカメラフレーム＋表情スコアを、Studio 内で共有する。
// 最新1件だけをメモリに置き、SSE の購読者へそのまま配る（保存しない）。
export interface LiveVision {
  frame: string; // data:image/jpeg;base64,...
  expressions: { smile: number; surprised: number; confused: number };
  face: { count: number; box: { x: number; y: number; w: number; h: number } | null };
  distanceM: number | null;
  yaw: number;
  at: number;
}

type Subscriber = (v: LiveVision) => void;

// 開発時のHMRでモジュールが作り直されても最新値と購読者を残す
const g = globalThis as typeof globalThis & {
  __mirageVisionLive?: LiveVision;
  __mirageVisionSubs?: Set<Subscriber>;
};

export function publishVision(v: LiveVision) {
  g.__mirageVisionLive = v;
  for (const fn of g.__mirageVisionSubs ?? []) {
    try {
      fn(v);
    } catch {
      /* 切断済みの購読者は無視 */
    }
  }
}

export function getVision(): LiveVision | null {
  return g.__mirageVisionLive ?? null;
}

export function subscribeVision(fn: Subscriber): () => void {
  (g.__mirageVisionSubs ??= new Set()).add(fn);
  return () => {
    g.__mirageVisionSubs?.delete(fn);
  };
}
