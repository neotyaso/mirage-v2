import { useFrame, useThree } from "@react-three/fiber";
import type { RefObject } from "react";
import type { FaceCenter } from "../hooks/useFaceDetection";

// Off-axis カメラ: 来場者の顔位置でカメラが動く
export const CAM_BASE: [number, number, number] = [0, 1.1, 3];
const CAM_RANGE_X = 0.8; // 顔が端にいると左右±0.8m動く
const CAM_RANGE_Y = 0.35;
const CAM_LERP = 0.06; // 追従の滑らかさ（小さいほど遅れる）

export function OffAxisCamera({ faceCenterRef }: { faceCenterRef: RefObject<FaceCenter | null> }) {
  const { camera } = useThree();

  useFrame(() => {
    const fc = faceCenterRef.current;
    // 顔なし → 中央に戻る
    // 表示映像は鏡像（scaleX(-1)）。来場者が自分の右に動く→鏡像では右に見える
    // →同じ方向にカメラを動かすため fc.x をそのまま使う
    const tx = fc ? (fc.x - 0.5) * 2 * CAM_RANGE_X : 0;
    const ty = fc ? (0.5 - fc.y) * 2 * CAM_RANGE_Y : 0;

    camera.position.x += (CAM_BASE[0] + tx - camera.position.x) * CAM_LERP;
    camera.position.y += (CAM_BASE[1] + ty - camera.position.y) * CAM_LERP;
    camera.position.z = CAM_BASE[2];

    // カメラは常にシーン中央（キャラの腰付近）を向く
    camera.lookAt(0, 1.1, 0);
  });

  return null;
}
