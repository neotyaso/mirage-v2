// WebRTC のシグナリング用メールボックス（開発・確認用）。
// Mirage が送信側、Studio の /vision が受信側。SDP の交換だけを HTTP で行い、
// 映像そのものはブラウザ同士の P2P で流す。サーバーは SDP を保持するだけ。
export interface VisionRtcSession {
  id: string;
  offer: string;
  answer?: string;
  createdAt: number;
  claimedAt?: number;
}

const g = globalThis as typeof globalThis & {
  __mirageVisionRtc?: Map<string, VisionRtcSession>;
};

function store() {
  return (g.__mirageVisionRtc ??= new Map());
}

// 未接続のまま放置されたセッションを掃除する（SDPは数KBなので実害はないが溜めない）
function cleanup() {
  const now = Date.now();
  for (const [id, s] of store()) {
    const ttl = s.answer ? 120_000 : 30_000;
    if (now - s.createdAt > ttl) store().delete(id);
  }
}

export function createSession(offer: string): VisionRtcSession {
  cleanup();
  const session: VisionRtcSession = {
    id: crypto.randomUUID(),
    offer,
    createdAt: Date.now(),
  };
  store().set(session.id, session);
  return session;
}

/** まだ誰も処理していない最も古い offer を1件返して「処理中」にする。 */
export function claimOffer(): VisionRtcSession | null {
  cleanup();
  for (const s of store().values()) {
    if (!s.claimedAt) {
      s.claimedAt = Date.now();
      return s;
    }
  }
  return null;
}

export function setAnswer(id: string, answer: string): boolean {
  const s = store().get(id);
  if (!s) return false;
  s.answer = answer;
  return true;
}

export function getAnswer(id: string): string | null {
  return store().get(id)?.answer ?? null;
}
