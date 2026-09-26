// フレームワーク非依存の通行人トラッカー。
// useFaceDetection は読み取り専用で参照するだけにし、ここには React / MediaPipe を持ち込まない。
//
// 使い方（App統合担当向け）:
//   const tracker = createVisitorTracker(); // zone判定はm基準(zoneForD)に一本化済み
//   // 150ms間隔などのポーリングで:
//   const faces = allFaceCentersRef.current.map((c, i) => ({ ...c, size: <i番目の顔幅> }));
//   const { active, left } = tracker.update(faces, performance.now());
//   // left に入った Visitor ごとに eventLog.append("leave", v.id, {...}) を呼ぶ。
//
// 注意:
// - MediaPipe の faceLandmarks 配列はフレームごとに並び順が変わりうるため、
//   インデックスではなく「前フレーム位置との距離」で同一人物を照合する
//   （useFaceDetection の primaryCenter と同じ考え方）。
// - 座標は正規化座標（FaceCenter と同一）。時刻は呼び出し側の基準（performance.now()）で統一すること。

import type { FaceObservation, PositionSample, Visitor, VisitorZone, ZoneSample } from "./types.js";
import { zoneForD } from "./types.js";

export interface VisitorTrackerOptions {
  /** この距離（正規化座標のユークリッド距離）以内の最近傍を同一人物とみなす。既定 0.15。 */
  matchDistance?: number;
  /** この ms だけ未観測が続いたら leave 判定。既定 4000。 */
  leaveAfterMs?: number;
  /** Visitor.positions の保持上限（古いものから捨てる）。既定 120。 */
  maxPositions?: number;
  /** 速度推定に使う直近ウィンドウ。既定 500ms。 */
  velocityWindowMs?: number;
}

export interface TrackerUpdate {
  /** 現在追跡中（leave 判定前）の全 Visitor。 */
  active: Visitor[];
  /** 今回の update で leave 判定された Visitor（呼び出しごとに新規分のみ）。 */
  left: Visitor[];
}

export interface VisitorTracker {
  update(faces: FaceObservation[], nowMs: number): TrackerUpdate;
  getActive(): Visitor[];
  reset(): void;
}

const DEFAULT_MATCH_DISTANCE = 0.15;
const DEFAULT_LEAVE_AFTER_MS = 4000;
const DEFAULT_MAX_POSITIONS = 120;
const DEFAULT_VELOCITY_WINDOW_MS = 500;

export function zoneForSize(size: number, d?: number | null): VisitorZone {
  if (size <= 0) return "absent";
  if (typeof d === "number") return zoneForD(d);
  if (size < 0.12) return "far";
  if (size < 0.25) return "mid";
  return "near";
}

function estimateVelocity(positions: PositionSample[], windowMs: number): { vx: number; vy: number } {
  if (positions.length < 2) return { vx: 0, vy: 0 };
  const latest = positions[positions.length - 1];
  const cutoff = latest.t - windowMs;
  let earliest: PositionSample | null = null;
  for (const p of positions) {
    if (p.t >= cutoff) {
      earliest = p;
      break;
    }
  }
  if (!earliest || earliest === latest) return { vx: 0, vy: 0 };
  const dtSec = (latest.t - earliest.t) / 1000;
  if (dtSec <= 0) return { vx: 0, vy: 0 };
  return {
    vx: (latest.x - earliest.x) / dtSec,
    vy: (latest.y - earliest.y) / dtSec,
  };
}

function cloneVisitor(v: Visitor): Visitor {
  return {
    ...v,
    positions: v.positions.slice(),
    zones: v.zones.slice(),
    velocity: { ...v.velocity },
    interest: { ...v.interest },
  };
}

// ---- 距離Dの1次元等速Kalman(依存なし・約30行) ----
// 状態[x=D, v=dD/dt]。顔幅/IPD由来の観測ノイズ(σ≒0.3m)を抑えつつ急接近には追従する。
// R: 観測ノイズ分散、Q_VEL: 速度の過程ノイズ(大きいほど追従速い・揺れる)。
const KF_R = 0.09;
const KF_Q_VEL = 2.0;
const KF_Q_POS = 0.2;
interface Kf1D {
  x: number;
  v: number;
  p00: number;
  p01: number;
  p11: number;
  lastT: number;
}
function kfInit(z: number, t: number): Kf1D {
  return { x: z, v: 0, p00: 1, p01: 0, p11: 1, lastT: t };
}
function kfStep(kf: Kf1D, z: number | null, t: number): void {
  const dt = Math.min(1, Math.max(0.01, (t - kf.lastT) / 1000));
  kf.lastT = t;
  // 予測(等速)
  kf.x += kf.v * dt;
  kf.p00 += dt * (kf.p01 + kf.p01) + dt * dt * kf.p11 + KF_Q_POS * dt;
  kf.p01 += dt * kf.p11;
  kf.p11 += KF_Q_VEL * dt;
  if (z === null || !Number.isFinite(z)) return; // 観測なし→予測のみ
  // 更新
  const y = z - kf.x;
  const s = kf.p00 + KF_R;
  const k0 = kf.p00 / s;
  const k1 = kf.p01 / s;
  kf.x += k0 * y;
  kf.v += k1 * y;
  const p00 = kf.p00;
  const p01 = kf.p01;
  kf.p00 = (1 - k0) * p00;
  kf.p01 = (1 - k0) * p01;
  kf.p11 = kf.p11 - k1 * p00;
}

// ---- 寄りそう度スコア(依存なし) ----
export const DEFAULT_INTEREST_WEIGHTS = { approach: 0.4, dwell: 0.25, face: 0.2, smile: 0.15 };
export const INTEREST_CALL_THRESHOLD = 0.55;

export interface InterestInput {
  d?: number | null;
  vd?: number;
  dwellS?: number;
  yaw?: number;
  smile?: number;
}

export type InterestWeights = { approach: number; dwell: number; face: number; smile: number };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function computeInterest(
  input: InterestInput,
  weights: Partial<InterestWeights> = {},
): number {
  const w = { ...DEFAULT_INTEREST_WEIGHTS, ...weights };
  const vd = input.vd ?? 0;
  const dwellS = input.dwellS ?? 0;
  const yaw = input.yaw ?? 0;
  const smile = input.smile ?? 0;
  const approachNorm = vd < 0 ? Math.min(1, -vd / 1.5) : 0;
  const dwellNorm = Math.min(1, Math.max(0, dwellS) / 8);
  const faceNorm = 1 - Math.min(1, Math.abs(yaw) / 0.8);
  const smileNorm = clamp01(smile);
  return clamp01(
    w.approach * approachNorm + w.dwell * dwellNorm + w.face * faceNorm + w.smile * smileNorm,
  );
}

function interestFor(v: Pick<Visitor, "vd" | "yaw" | "smile" | "firstSeenMs">, nowMs: number): {
  score: number;
  updatedMs: number;
} {
  return {
    score: computeInterest({
      d: null,
      vd: v.vd,
      dwellS: (nowMs - v.firstSeenMs) / 1000,
      yaw: v.yaw,
      smile: v.smile,
    }),
    updatedMs: nowMs,
  };
}

export function createVisitorTracker(options: VisitorTrackerOptions = {}): VisitorTracker {
  const matchDistance = options.matchDistance ?? DEFAULT_MATCH_DISTANCE;
  const leaveAfterMs = options.leaveAfterMs ?? DEFAULT_LEAVE_AFTER_MS;
  const maxPositions = options.maxPositions ?? DEFAULT_MAX_POSITIONS;
  const velocityWindowMs = options.velocityWindowMs ?? DEFAULT_VELOCITY_WINDOW_MS;

  const active = new Map<string, Visitor>();
  const kfById = new Map<string, Kf1D>();
  let nextId = 1;

  function observeNew(obs: FaceObservation, nowMs: number): Visitor {
    const zone = zoneForSize(obs.size, obs.d ?? undefined);
    const dRaw = obs.d ?? null;
    const v: Visitor = {
      id: `v${nextId++}`,
      firstSeenMs: nowMs,
      lastSeenMs: nowMs,
      positions: [{ t: nowMs, x: obs.x, y: obs.y, size: obs.size, d: dRaw }],
      velocity: { vx: 0, vy: 0 },
      zones: [{ t: nowMs, zone } satisfies ZoneSample],
      dRaw,
      d: dRaw,
      vd: 0,
      yaw: obs.yaw ?? 0,
      smile: obs.smile ?? 0,
      interest: { score: 0, updatedMs: nowMs },
    };
    v.interest = interestFor(v, nowMs);
    active.set(v.id, v);
    if (dRaw !== null && Number.isFinite(dRaw)) kfById.set(v.id, kfInit(dRaw, nowMs));
    return v;
  }

  function observeExisting(v: Visitor, obs: FaceObservation, nowMs: number): void {
    v.lastSeenMs = nowMs;
    if (obs.yaw !== undefined) v.yaw = obs.yaw;
    if (obs.smile !== undefined) v.smile = obs.smile;
    const dRaw = obs.d ?? null;
    v.positions.push({ t: nowMs, x: obs.x, y: obs.y, size: obs.size, d: dRaw });
    if (v.positions.length > maxPositions) {
      v.positions.splice(0, v.positions.length - maxPositions);
    }
    v.velocity = estimateVelocity(v.positions, velocityWindowMs);
    v.dRaw = dRaw;
    // Kalman平滑: 観測Dがあれば更新、なければ前回値維持(予測のみは次回観測時にdtで補正)
    let kf = kfById.get(v.id);
    if (dRaw !== null && Number.isFinite(dRaw)) {
      if (!kf) {
        kf = kfInit(dRaw, nowMs);
        kfById.set(v.id, kf);
      } else {
        kfStep(kf, dRaw, nowMs);
      }
      v.d = kf.x;
      v.vd = kf.v;
    } else if (kf) {
      kfStep(kf, null, nowMs);
      v.d = kf.x;
      v.vd = kf.v;
    }
    const zone = zoneForSize(obs.size, obs.d ?? undefined);
    const lastZone = v.zones[v.zones.length - 1];
    if (!lastZone || lastZone.zone !== zone) {
      v.zones.push({ t: nowMs, zone });
    }
    v.interest = interestFor(v, nowMs);
  }

  return {
    update(faces: FaceObservation[], nowMs: number): TrackerUpdate {
      // 貪欲な最近傍マッチング（置換なし）。観測も追跡中も少数（通常1〜4）の想定。
      const unmatched = new Map(active);
      const matched = new Set<string>();
      // 安定のため x 昇順で処理順を固定（入力順序に依存しない）。
      const ordered = faces.slice().sort((a, b) => a.x - b.x);
      for (const obs of ordered) {
        let bestId: string | null = null;
        let bestDist = Infinity;
        for (const [id, v] of unmatched) {
          const last = v.positions[v.positions.length - 1];
          if (!last) continue;
          // x,y近傍＋D前後ペナルティ。Dなし観測/追跡では旧来通りx,yのみで判定(互換維持)。
          let d = Math.hypot(obs.x - last.x, obs.y - last.y);
          const obsD = obs.d ?? null;
          const lastD = last.d ?? v.d;
          if (obsD !== null && Number.isFinite(obsD) && lastD !== null && Number.isFinite(lastD)) {
            d += Math.min(0.3, Math.abs(obsD - lastD) * 0.15);
          }
          if (d < bestDist) {
            bestDist = d;
            bestId = id;
          }
        }
        if (bestId !== null && bestDist <= matchDistance) {
          const v = unmatched.get(bestId);
          if (v) {
            observeExisting(v, obs, nowMs);
            unmatched.delete(bestId);
            matched.add(bestId);
          }
        } else {
          const v = observeNew(obs, nowMs);
          matched.add(v.id);
        }
      }

      // leave 判定: マッチしなかった追跡のうち、未観測が leaveAfterMs を超えたもの。
      const left: Visitor[] = [];
      for (const [id, v] of unmatched) {
        if (!matched.has(id) && nowMs - v.lastSeenMs >= leaveAfterMs) {
          left.push(cloneVisitor(v));
          active.delete(id);
          kfById.delete(id);
        }
      }

      return {
        active: [...active.values()].map(cloneVisitor),
        left,
      };
    },

    getActive(): Visitor[] {
      return [...active.values()].map(cloneVisitor);
    },

    reset(): void {
      active.clear();
      kfById.clear();
      nextId = 1;
    },
  };
}
