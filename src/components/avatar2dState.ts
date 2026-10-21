// 2Dアバターの状態更新（描画なし・純関数）。rAFループから毎フレーム呼ぶ。
// 3D版Avatar.tsxのまばたき・口パク・注視の数式をそのまま移植し、
// OffAxisCameraの視差は画面内の平行移動に置き換えた。
import type { FaceCenter } from "../hooks/useFaceDetection";

export interface Avatar2DState {
  blinkClock: number;
  nextBlink: number;
  mouth: number;
  gazeX: number;
  gazeY: number;
  parX: number;
  parY: number;
}

export interface Avatar2DInput {
  speaking: boolean;
  volume: number;
  time: number; // 秒。無音時の口パクの位相
  face: FaceCenter | null;
  eye: FaceCenter | null;
}

const BLINK_DURATION_S = 0.12;
// viewBox(200幅)基準の値。画面では約2.8倍に拡大されるので控えめにする
const GAZE_PX = 4;
const GAZE_Y_PX = 3;
// 3Dカメラ(±0.8m)の代わり。2Dでは「画面が少しついてくる」程度に留める
const PARALLAX_X_PX = 10;
const PARALLAX_Y_PX = 6;
const MAX_DELTA_S = 1 / 20;
const GAZE_LERP = 0.08;
const MOUTH_LERP = 0.35;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function createAvatar2DState(): Avatar2DState {
  return {
    blinkClock: 0,
    nextBlink: 2 + Math.random() * 3,
    mouth: 0,
    gazeX: 0,
    gazeY: 0,
    parX: 0,
    parY: 0,
  };
}

/** 1フレーム進める。blinkは0=開く/1=閉じる。 */
export function stepAvatar2D(
  s: Avatar2DState,
  rawDelta: number,
  input: Avatar2DInput
): { state: Avatar2DState; blink: number } {
  const dt = Math.min(Math.max(rawDelta, 0), MAX_DELTA_S);

  // まばたき: 2〜5秒間隔で0.12秒閉じる
  const blinkClock = s.blinkClock + dt;
  let nextBlink = s.nextBlink;
  let blink = 0;
  const since = blinkClock - nextBlink;
  if (since >= 0) {
    const p = since / BLINK_DURATION_S;
    if (p >= 1) {
      nextBlink = blinkClock + 2 + Math.random() * 3;
    } else {
      blink = Math.sin(p * Math.PI);
    }
  }

  // 口: 発話中は音量、音量が取れない間は適当な振幅で動かす
  const target = input.speaking
    ? input.volume > 0
      ? clamp01(input.volume * 1.4)
      : clamp01(0.2 + 0.6 * Math.abs(Math.sin(input.time * 16)))
    : 0;
  const mouth = lerp(s.mouth, target, MOUTH_LERP);

  // 注視: 目が取れれば目、無ければ顔の中心。鏡像表示なので3D版と同じ向き
  const focus = input.eye ?? input.face ?? null;
  const gazeTargetX = focus ? lerp(-1, 1, 1 - focus.x) * GAZE_PX : 0;
  const gazeTargetY = focus ? (focus.y - 0.5) * 2 * GAZE_Y_PX : 0;
  const gazeX = lerp(s.gazeX, gazeTargetX, GAZE_LERP);
  const gazeY = lerp(s.gazeY, gazeTargetY, GAZE_LERP);

  // 視差: 顔が右→画面が左へ、顔が上→画面が下へ（カメラ移動の見え方を近似）
  const face = input.face;
  const parTargetX = face ? -(face.x - 0.5) * 2 * PARALLAX_X_PX : 0;
  const parTargetY = face ? (0.5 - face.y) * 2 * PARALLAX_Y_PX : 0;
  const parX = lerp(s.parX, parTargetX, GAZE_LERP);
  const parY = lerp(s.parY, parTargetY, GAZE_LERP);

  return {
    state: { blinkClock, nextBlink, mouth, gazeX, gazeY, parX, parY },
    blink,
  };
}
