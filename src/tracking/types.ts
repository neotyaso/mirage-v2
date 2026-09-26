// 通行人トラッキング＋呼び込みイベントログの型定義。
//
// 座標系は useFaceDetection の FaceCenter と同一の正規化座標を使う:
//   x: 0〜1（左→右）、y: 0〜1（上→下）、size: 顔の正規化幅（faceSizeRef と同一）
// 将来の俯瞰可視化・声かけポリシー・呼び込み効果測定はこの型の上に乗る。

/** 1フレーム分の位置サンプル。t は呼び出し側の時刻基準（performance.now() 等）の ms。 */
export interface PositionSample {
  t: number;
  x: number;
  y: number;
  size: number;
  /** 推定距離m(呼び出し側で estimateDistanceM 済みの場合)。未計算は undefined。 */
  d?: number | null;
}

/** 速度の推定値（正規化座標/秒）。+vx = 画面右方向、+vy = 画面下方向。 */
export interface Velocity {
  vx: number;
  vy: number;
}

/**
 * 距離ゾーン。useFaceDetection の DistanceZone と一致させること
 * （"far" | "mid" | "near" | "absent"）。
 */
export type VisitorZone = "far" | "mid" | "near" | "absent";

/** ゾーン遷移の履歴サンプル。変化時のみ追記される。 */
export interface ZoneSample {
  t: number;
  zone: VisitorZone;
}

/** 通行人1人分の追跡レコード。 */
export interface Visitor {
  /** トラッカー内で採番した安定 id（例: "v1"）。フレームをまたいで同一人物に付与される。 */
  id: string;
  firstSeenMs: number;
  lastSeenMs: number;
  /** 軌道（時系列の位置サンプル）。 */
  positions: PositionSample[];
  /** 直近ウィンドウから推定した速度。 */
  velocity: Velocity;
  /** 生の推定距離m(最新観測)。未計算時はnull。 */
  dRaw: number | null;
  /** Kalman平滑済み距離m。未計算時はnull。Avatarの連続接近・寄りそう度はこっちを使う。 */
  d: number | null;
  /** 平滑距離の速度m/s(-=接近)。 */
  vd: number;
  /** 顔向きyaw最新値(ラジアン、0=正対)。既定0。 */
  yaw: number;
  /** 笑顔度(0〜1)。既定0。 */
  smile: number;
  /** 寄りそう度スコア。 */
  interest: { score: number; updatedMs: number };
  /** ゾーン遷移の履歴。 */
  zones: ZoneSample[];
}

/** 呼び込みイベント種別。 */
export type TrackEventType =
  | "callout"
  | "conversation_start"
  | "conversation_end"
  | "stop"
  | "leave";

/**
 * 時系列ログの1イベント。
 * visitorId が null の場合は来場者に紐づかない全体イベント（"stop" 等）。
 * variant は呼び込みABテスト用の実験条件ラベル（例: "A" / "B"）。
 */
export interface TrackEvent {
  type: TrackEventType;
  visitorId: string | null;
  /** イベント時刻（append 側の時刻基準の ms）。 */
  t: number;
  /** 種別ごとの付随データ（例: callout の zone / text、leave の滞在時間等）。 */
  data?: Record<string, unknown>;
  variant?: string | null;
}

/**
 * トラッカーへの1フレーム分の入力。
 * useFaceDetection の allFaceCentersRef（FaceCenter[]）＋各顔の正規化幅に対応する。
 * 順序は不定でよい（MediaPipe はフレームごとに並び順が変わりうるため、順序に依存しないこと）。
 */
export interface FaceObservation {
  x: number;
  y: number;
  size: number;
  /** 眼間距離(IPD・正規化幅)。多人数対応用。なくても動く。 */
  ipd?: number;
  /** 推定距離m(呼び出し側で estimateDistanceM(size, ipd) 済みの場合)。あればKalman平滑に使う。 */
  d?: number | null;
  /** 顔向きyaw(ラジアン、0=正対)。なくても動く。 */
  yaw?: number;
  /** 笑顔度(0〜1)。なくても動く。 */
  smile?: number;
}

/** 距離ゾーンのm基準閾値。D=mは estimateDistanceM 由来の連続距離。 */
export const ZONE_FAR_M = 3.0;
export const ZONE_MID_M = 1.4;

/** 推定距離m→ゾーン。null=顔なし相当→"far"。 */
export function zoneForD(d: number | null): VisitorZone {
  if (d === null || !Number.isFinite(d)) return "far";
  if (d > ZONE_FAR_M) return "far";
  if (d > ZONE_MID_M) return "mid";
  return "near";
}
