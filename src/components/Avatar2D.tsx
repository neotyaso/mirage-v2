import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { createAvatar2DState, stepAvatar2D } from "./avatar2dState";
import type { FaceCenter } from "../hooks/useFaceDetection";

export interface Avatar2DProps {
  speakingRef?: RefObject<boolean>;
  volumeRef?: RefObject<number>;
  faceCenterRef?: RefObject<FaceCenter | null>;
  eyeCenterRef?: RefObject<FaceCenter | null>;
  paused?: boolean;
}

/**
 * 2Dアバターのプレースホルダ。
 * 素材は未定なので、差し替え前提のSVGシルエットで配線だけ通す。
 * 状態はCSS変数で流し込む（Reactの再描画なし）。
 * shortcut: 静止画1枚 + 変形のみ。素材が決まったら画像/動画レイヤーに差し替える
 */
export function Avatar2D({ speakingRef, volumeRef, faceCenterRef, eyeCenterRef, paused }: Avatar2DProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || paused) return;

    let state = createAvatar2DState();
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      const next = stepAvatar2D(state, dt, {
        speaking: speakingRef?.current ?? false,
        volume: volumeRef?.current ?? 0,
        time: now / 1000,
        face: faceCenterRef?.current ?? null,
        eye: eyeCenterRef?.current ?? null,
      });
      state = next.state;

      el.style.setProperty("--blink", String(next.blink));
      el.style.setProperty("--mouth", String(next.state.mouth));
      el.style.setProperty("--gaze-x", `${next.state.gazeX}px`);
      el.style.setProperty("--gaze-y", `${next.state.gazeY}px`);
      el.style.setProperty("--par-x", `${next.state.parX}px`);
      el.style.setProperty("--par-y", `${next.state.parY}px`);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, speakingRef, volumeRef, faceCenterRef, eyeCenterRef]);

  return (
    <div ref={rootRef} style={wrapStyle} aria-hidden="true">
      <svg viewBox="0 0 200 320" style={svgStyle}>
        <g style={{ transform: "translate(var(--par-x, 0px), var(--par-y, 0px))" }}>
          {/* 体 */}
          <path d="M100 166 C144 166 162 208 162 320 L38 320 C38 208 56 166 100 166 Z" fill="#9fb3cc" />
          {/* 首 */}
          <rect x="88" y="150" width="24" height="32" rx="11" fill="#dbe3ee" />
          {/* 頭 */}
          <circle cx="100" cy="110" r="54" fill="#e6ecf5" />
          {/* 目（gaze で瞳ごと動く。blink でscaleY=0に潰す） */}
          <g style={{ transform: "translate(var(--gaze-x, 0px), var(--gaze-y, 0px))" }}>
            <ellipse cx="79" cy="108" rx="8" ry="11" fill="#263243" style={eyeStyle} />
            <ellipse cx="121" cy="108" rx="8" ry="11" fill="#263243" style={eyeStyle} />
          </g>
          {/* 口 */}
          <ellipse cx="100" cy="141" rx="14" ry="9" fill="#263243" style={mouthStyle} />
        </g>
      </svg>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
};

const svgStyle: CSSProperties = {
  height: "82vh",
  width: "auto",
  overflow: "visible",
};

// --blink: 0=開く / 1=閉じる
const eyeStyle: CSSProperties = {
  transformBox: "fill-box",
  transformOrigin: "center",
  transform: "scaleY(calc(1 - var(--blink, 0)))",
};

// --mouth: 0=閉じる / 1=大きく開く
const mouthStyle: CSSProperties = {
  transformBox: "fill-box",
  transformOrigin: "center",
  transform: "scaleY(calc(0.12 + 1.1 * var(--mouth, 0)))",
};
