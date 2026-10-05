import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { Matrix4, Quaternion, Euler, Vector3 } from "three";
import { zoneForD } from "../tracking/types";

const ABSENCE_GRACE_MS = 600;
// 顔幅(faceSizeRef)の平滑化係数。生のバウンディングボックス幅は首を振る/俯く等の
// 一瞬の姿勢変化だけでもガクッと変動し、距離ゾーン(getDistanceZone)の閾値をまたいで
// キャラが急に歩き出す/後ずさりする原因になっていた。指数移動平均で軽くならす
const FACE_SIZE_SMOOTHING = 0.35;

export interface FaceCenter {
  x: number; // 0〜1（左→右）
  y: number; // 0〜1（上→下）
}

// 目尻・目頭の4点(MediaPipe 468点トポロジの固定インデックス)。虹彩ランドマークは
// モデルによって出力有無が変わるため使わず、常に存在する目の輪郭点の平均で近似する
const EYE_CORNER_LANDMARK_INDICES = [33, 133, 362, 263];
// IPD用に左右を分離。左目(33,133)の中心と右目(362,263)の中心の距離を眼間距離とする。
const LEFT_EYE_INDICES = [33, 133];
const RIGHT_EYE_INDICES = [362, 263];

export interface FaceExpression {
  smile: number;    // 0〜1
  surprised: number; // 0〜1
}

// 顔の正規化幅（0〜1）→距離の代理指標
// 目安: m基準のzoneForD(ZONE_FAR_M/ZONE_MID_M)に一本化
export type DistanceZone = "far" | "mid" | "near" | "absent";

// ---- 連続距離推定 D = k / faceSize (P3: 固定k運用) ----
// ピンホール近似: faceSize ≒ f*W/(D*I) → D = k/faceSize (k=f*W/I)。
// kはカメラ固定値なので現場校正なしで自動化する。人体側WはIPD実寸63mm(個人差±5%)に乗り、
// カメラ側f/Iは同機種・同解像度なら不変のため。固定値の根拠: far 0.12→3.0m、mid 0.25→1.44mと旧閾値に整合。
// ponytail: 機種変更でズレたらFOV由来k(k=W/(2*tan(FOV/2)))の計算で置換、それまでは固定値
const DISTANCE_K = 0.36;
// ---- IPD測距 D = k_ipd / ipd ----
// 眼間距離(IPD実測≒63mm)は顔幅より個人差が小さい(±5% vs ±15%)ため主物差しにする。
const DISTANCE_K_IPD = 0.15;

/** 現在のk_ipd。D = k_ipd / ipd。 */
export function getDistanceKipd(): number {
  return DISTANCE_K_IPD;
}

/** 現在のk(単位:m)。D = k / faceSize。 */
export function getDistanceK(): number {
  return DISTANCE_K;
}
/**
 * 顔幅→推定距離m。顔なし(size<=0)はnull。
 * ipd(眼間距離)を渡すとIPD優先・顔幅fallback: 横顔等でipdが取れない時だけ顔幅式を使う。
 */
export function estimateDistanceM(faceSize: number, ipd?: number): number | null {
  if (ipd !== undefined && Number.isFinite(ipd) && ipd > 0.015) {
    return DISTANCE_K_IPD / Math.max(ipd, 1e-4);
  }
  if (!Number.isFinite(faceSize) || faceSize <= 0) return null;
  return DISTANCE_K / Math.max(faceSize, 1e-4);
}
// 連続接近度への写像範囲。D<=NEARで1(目の前)、D>=FARで0(奥)。
export const DISTANCE_NEAR_M = 0.8;
export const DISTANCE_FAR_M = 4.0;
/** 推定距離m→連続接近度0〜1。null(顔なし)は0。 */
export function distanceToApproach(d: number | null): number {
  if (d === null || !Number.isFinite(d)) return 0;
  const t = 1 - (d - DISTANCE_NEAR_M) / (DISTANCE_FAR_M - DISTANCE_NEAR_M);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
/** 顔幅→連続接近度0〜1のショートカット。 */
export function approachFromFaceSize(faceSize: number): number {
  return distanceToApproach(estimateDistanceM(faceSize));
}

export function getDistanceZone(faceSize: number, ipd?: number): DistanceZone {
  if (faceSize <= 0) return "absent";
  return zoneForD(estimateDistanceM(faceSize, ipd));
}

export function useFaceDetection(enabled: boolean = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const presentRef = useRef(false);
  const faceCountRef = useRef(0);
  const faceCenterRef = useRef<FaceCenter | null>(null);
  const eyeCenterRef = useRef<FaceCenter | null>(null); // 顔全体でなく目の高さ・位置(視線を合わせる用)
  const faceSizeRef = useRef(0);
  const eyeDistanceRef = useRef(0); // 主対象の眼間距離(IPD・正規化幅)。横顔等で取れない時は0
  const allEyeDistancesRef = useRef<number[]>([]); // 全顔分のIPD(visitorTrackerの多人数対応用)
  const allFaceSizesRef = useRef<number[]>([]); // 全顔分の正規化幅(visitorTrackerの多人数対応用)
  const faceYawRef = useRef(0); // 主対象の頭の左右向き（ラジアン。0=正面、絶対値が大きいほどそっぽを向いている）
  const allFaceCentersRef = useRef<FaceCenter[]>([]);
  const allEyeCentersRef = useRef<FaceCenter[]>([]);
  const expressionRef = useRef<FaceExpression>({ smile: 0, surprised: 0 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    let detector: FaceLandmarker | null = null;
    let stream: MediaStream | null = null;
    let rafId = 0;
    let stopped = false;
    let lastVideoTime = -1;
    let lastSeen = 0;
    // yaw抽出用に使い回すワークオブジェクト（毎フレームnewしない）
    const yawMatrix = new Matrix4();
    const yawPos = new Vector3();
    const yawQuat = new Quaternion();
    const yawScale = new Vector3();
    const yawEuler = new Euler();
    // MediaPipeのfaceLandmarks配列は複数人検出時、フレームごとに並び順が入れ替わりうる
    // （landmarks[0]が別人になる）。素直にindex 0を使うと、2人目が現れた瞬間に
    // カメラ追従・距離判定・視線の基準が別人に急に切り替わってしまう。
    // 直前フレームで「話しかけてる相手」だった顔に最も近い顔を、今回も同一人物として追い続ける。
    let primaryCenter: FaceCenter | null = null;

    function blendshapeScore(
      categories: { categoryName: string; score: number }[],
      ...names: string[]
    ): number {
      let sum = 0;
      let count = 0;
      for (const c of categories) {
        if (names.includes(c.categoryName)) { sum += c.score; count++; }
      }
      return count > 0 ? sum / count : 0;
    }

    function loop() {
      if (stopped) return;
      const video = videoRef.current;
      if (
        video &&
        detector &&
        video.readyState >= 2 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        const now = performance.now();
        const result = detector.detectForVideo(video, now);

        const landmarks = result.faceLandmarks ?? [];
        const blendshapes = result.faceBlendshapes ?? [];
        const transforms = result.facialTransformationMatrixes ?? [];
        const count = landmarks.length;
        faceCountRef.current = count;

        if (count > 0) {
          lastSeen = now;

          // 各顔の中心・横幅をランドマークのバウンディングボックスから計算
          const centers: FaceCenter[] = landmarks.map((lm) => {
            const xs = lm.map((p) => p.x);
            const ys = lm.map((p) => p.y);
            const minX = Math.min(...xs), maxX = Math.max(...xs);
            const minY = Math.min(...ys), maxY = Math.max(...ys);
            return {
              x: (minX + maxX) / 2,
              y: (minY + maxY) / 2,
            };
          });
          const widths = landmarks.map((lm) => {
            const xs = lm.map((p) => p.x);
            return Math.max(...xs) - Math.min(...xs);
          });
          const eyeCenters: FaceCenter[] = landmarks.map((lm, i) => {
            const pts = EYE_CORNER_LANDMARK_INDICES.map((idx) => lm[idx]).filter(Boolean);
            if (pts.length === 0) return centers[i];
            return {
              x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
              y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
            };
          });
          // 眼間距離(IPD): 左右目の中心間ユークリッド距離(正規化座標)。片目欠損時は0=fallback合図
          const eyeDistances: number[] = landmarks.map((lm) => {
            const l = LEFT_EYE_INDICES.map((idx) => lm[idx]).filter(Boolean);
            const r = RIGHT_EYE_INDICES.map((idx) => lm[idx]).filter(Boolean);
            if (l.length === 0 || r.length === 0) return 0;
            const lx = l.reduce((s, p) => s + p.x, 0) / l.length;
            const ly = l.reduce((s, p) => s + p.y, 0) / l.length;
            const rx = r.reduce((s, p) => s + p.x, 0) / r.length;
            const ry = r.reduce((s, p) => s + p.y, 0) / r.length;
            return Math.hypot(lx - rx, ly - ry);
          });

          // 「話しかけてる相手」の主対象を選ぶ。直前フレームで追っていた位置に一番近い顔を
          // 引き続き主対象にする（見失っていた/初回なら、一番大きい＝一番近い顔を選ぶ）
          let primaryIdx = 0;
          if (primaryCenter) {
            let bestDist = Infinity;
            centers.forEach((c, i) => {
              const d = Math.hypot(c.x - primaryCenter!.x, c.y - primaryCenter!.y);
              if (d < bestDist) { bestDist = d; primaryIdx = i; }
            });
          } else {
            let bestWidth = -Infinity;
            widths.forEach((w, i) => {
              if (w > bestWidth) { bestWidth = w; primaryIdx = i; }
            });
          }
          primaryCenter = centers[primaryIdx];

          allFaceCentersRef.current = centers;
          faceCenterRef.current = centers[primaryIdx] ?? null;
          allEyeCentersRef.current = eyeCenters;
          eyeCenterRef.current = eyeCenters[primaryIdx] ?? null;
          const rawWidth = widths[primaryIdx] ?? 0;
          faceSizeRef.current = faceSizeRef.current === 0
            ? rawWidth
            : faceSizeRef.current + (rawWidth - faceSizeRef.current) * FACE_SIZE_SMOOTHING;
          const rawIpd = eyeDistances[primaryIdx] ?? 0;
          eyeDistanceRef.current = rawIpd <= 0
            ? 0
            : eyeDistanceRef.current === 0
              ? rawIpd
              : eyeDistanceRef.current + (rawIpd - eyeDistanceRef.current) * FACE_SIZE_SMOOTHING;
          allEyeDistancesRef.current = eyeDistances;
          allFaceSizesRef.current = widths;

          // 頭の向き(yaw)を主対象の顔変換行列から抽出（そっぽを向いたか判定するため）
          const matrixData = transforms[primaryIdx]?.data;
          if (matrixData) {
            yawMatrix.fromArray(matrixData);
            yawMatrix.decompose(yawPos, yawQuat, yawScale);
            yawEuler.setFromQuaternion(yawQuat, "YXZ");
            faceYawRef.current = yawEuler.y;
          } else {
            faceYawRef.current = 0;
          }

          // blendshapesから表情スコアを抽出（主対象と同じ人物のインデックス）
          if (blendshapes.length > primaryIdx) {
            const cats = blendshapes[primaryIdx].categories;
            expressionRef.current = {
              smile: blendshapeScore(cats, "mouthSmileLeft", "mouthSmileRight"),
              surprised: blendshapeScore(cats, "browInnerUp", "eyeWideLeft", "eyeWideRight"),
            };
          }
        } else {
          primaryCenter = null;
          faceCenterRef.current = null;
          eyeCenterRef.current = null;
          faceSizeRef.current = 0;
          eyeDistanceRef.current = 0;
          allEyeDistancesRef.current = [];
          allFaceSizesRef.current = [];
          faceYawRef.current = 0;
          allFaceCentersRef.current = [];
          allEyeCentersRef.current = [];
          expressionRef.current = { smile: 0, surprised: 0 };
        }

        presentRef.current = now - lastSeen < ABSENCE_GRACE_MS;
      }
      rafId = requestAnimationFrame(loop);
    }

    async function init() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
          audio: false,
        });
        if (stopped) return;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setReady(true);

        const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        detector = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/mediapipe/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 4,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        if (stopped) return;

        loop();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    init();

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      detector?.close();
    };
  }, [enabled]);

  return {
    videoRef,
    presentRef,
    faceCountRef,
    faceCenterRef,
    eyeCenterRef,
    faceSizeRef,
    eyeDistanceRef,
    allEyeDistancesRef,
    allFaceSizesRef,
    faceYawRef,
    allFaceCentersRef,
    allEyeCentersRef,
    expressionRef,
    ready,
    error,
  };
}
