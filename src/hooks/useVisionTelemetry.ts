import { useEffect } from "react";
import type { RefObject } from "react";
import { captureFrame } from "../vision/visionComment";
import { estimateDistanceM } from "./useFaceDetection";
import type { FaceBox, FaceExpression } from "./useFaceDetection";

export interface VisionTelemetryInput {
  enabled: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  expressionRef: RefObject<FaceExpression>;
  faceBoxesRef: RefObject<FaceBox[]>;
  primaryFaceIndexRef: RefObject<number>;
  faceCountRef: RefObject<number>;
  faceSizeRef: RefObject<number>;
  eyeDistanceRef: RefObject<number>;
  faceYawRef: RefObject<number>;
}

/**
 * Studio のライブ映像モニタ（/vision）へ、小さなフレームと表情スコアを送る。
 * 画像はメモリ上で縮小して送るだけで、Studio 側も最新1枚を上書きするだけ（保存しない）。
 * Studio が落ちていても展示は止めない（失敗は無視）。100ms 間隔（約10fps）。
 */
export function useVisionTelemetry({
  enabled,
  videoRef,
  expressionRef,
  faceBoxesRef,
  primaryFaceIndexRef,
  faceCountRef,
  faceSizeRef,
  eyeDistanceRef,
  faceYawRef,
}: VisionTelemetryInput) {
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const id = setInterval(() => {
      if (busy || document.visibilityState === "hidden") return;
      const video = videoRef.current;
      const frame = video ? captureFrame(video, 160, 0.55) : null;
      if (!frame) return;
      const boxes = faceBoxesRef.current ?? [];
      const box = boxes[primaryFaceIndexRef.current ?? 0] ?? null;
      const expr = expressionRef.current;
      busy = true;
      void fetch("/studio/api/vision/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frame,
          expressions: { smile: expr.smile, surprised: expr.surprised, confused: expr.confused },
          face: { count: faceCountRef.current ?? 0, box },
          distanceM: estimateDistanceM(faceSizeRef.current, eyeDistanceRef.current),
          yaw: faceYawRef.current ?? 0,
        }),
        signal: AbortSignal.timeout(3000),
      })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    }, 100);
    return () => clearInterval(id);
  }, [enabled, videoRef, expressionRef, faceBoxesRef, primaryFaceIndexRef, faceCountRef, faceSizeRef, eyeDistanceRef, faceYawRef]);
}
