import { useEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { calibrateDistanceAt, estimateDistanceM, getDistanceK, getDistanceKipd, getDistanceZone } from "../hooks/useFaceDetection";
import type { DistanceZone } from "../hooks/useFaceDetection";
import type { ConversationEngine } from "../hooks/useConversationEngine";
import type { VisitorTracker } from "../tracking/visitorTracker";
import { BevMap } from "./BevMap";

export interface DebugPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  presentRef: RefObject<boolean>;
  faceCountRef: RefObject<number>;
  faceSizeRef: RefObject<number>;
  eyeDistanceRef: RefObject<number>;
  camReady: boolean;
  camError: string | null;
  started: boolean;
  paused: boolean;
  eng: ConversationEngine;
  trackerRef: RefObject<VisitorTracker | null>;
  onTogglePause: () => void;
}

// デバッグUI。dキーで表示切替、cキーで距離の設置時1点校正（今映っている顔を2mとみなす）。
// 表示用の値はAppの判断ロジックとは独立に、refを250ms間隔で読んで自前で持つ。
// 検出用カメラもここでマウントする（顔検出が参照する実体。dキーで表示切替）。
export function DebugPanel(props: DebugPanelProps) {
  const { videoRef, presentRef, faceCountRef, faceSizeRef, eyeDistanceRef, eng } = props;
  const [debugMode, setDebugMode] = useState(false);
  const [snap, setSnap] = useState({ present: false, faces: 0, zone: "absent" as DistanceZone, faceSize: 0, eyeDist: 0 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "d") { setDebugMode((v) => !v); return; }
      if (!debugMode) return; // 校正はデバッグHUD表示中のみ受け付ける（本番中の誤爆防止）
      if (e.key === "c") { calibrateDistanceAt(faceSizeRef.current, 2, eyeDistanceRef.current); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [debugMode, faceSizeRef, eyeDistanceRef]);

  useEffect(() => {
    const id = setInterval(() => {
      setSnap({
        present: presentRef.current,
        faces: faceCountRef.current,
        zone: getDistanceZone(faceSizeRef.current, eyeDistanceRef.current),
        faceSize: faceSizeRef.current,
        eyeDist: eyeDistanceRef.current,
      });
    }, 250);
    return () => clearInterval(id);
  }, [presentRef, faceCountRef, faceSizeRef, eyeDistanceRef]);

  const dist = estimateDistanceM(snap.faceSize, snap.eyeDist);
  const conv = eng.activeConvState;

  return (
    <>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: 160,
          height: 120,
          objectFit: "cover",
          transform: "scaleX(-1)",
          border: snap.present ? "2px solid #0f8" : "2px solid #333",
          borderRadius: 6,
          zIndex: 10,
          visibility: debugMode ? "visible" : "hidden",
        }}
      />

      {props.started && debugMode && (
        <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8 }}>
          <button
            style={{ ...callBtnStyle, background: props.paused ? "#22c55e" : "#ef4444" }}
            onClick={props.onTogglePause}
          >
            {props.paused ? "▶ 再開" : "⏸ 停止"}
          </button>
        </div>
      )}

      {props.started && debugMode && (
        <div style={convPanelStyle}>
          <div style={{ marginBottom: 8, display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              style={{ ...convBtnStyle, background: conv === "idle" ? "#8b5cf6" : "#ef4444" }}
              onClick={eng.toggleConversation}
            >
              {conv === "idle" ? "🎤 会話開始" : conv === "listening" ? "👂 聴いてる…" : conv === "thinking" ? "💭 考え中…" : "🔊 喋ってる"}
            </button>
            <button
              style={{ ...convBtnStyle, background: "#374151" }}
              onClick={eng.resetAll}
            >
              🔄 会話リセット
            </button>
          </div>
        </div>
      )}

      {debugMode && (
        <div style={hudStyle}>
          <div>
            cam: {props.camError ? `ERR ${props.camError}` : props.camReady ? "ok" : "…"} | 在席:{" "}
            {snap.present ? "YES" : "no"} | 顔: {snap.faces} | zone: {snap.zone} | conv: {conv} | {!props.started ? "停止中" : props.paused ? "一時停止中" : "稼働中"}
          </div>
          <div style={{ marginTop: 2, opacity: 0.85 }}>
            engine: {eng.engine} | gemini: {eng.geminiState} | via: {eng.via} | local: {eng.localState}
          </div>
          <div style={{ marginTop: 2, opacity: 0.85 }}>
            m: connectMs={eng.geminiMetrics.connectMs ?? "-"} | firstAudioMs={eng.geminiMetrics.firstAudioMs ?? "-"} | turns={eng.geminiMetrics.turns} | disconnects={eng.geminiMetrics.disconnects}
          </div>
          {eng.failureNotice && (
            <div style={{ marginTop: 2, color: "#fbbf24" }}>
              fail: {eng.failureNotice}
            </div>
          )}
          <div style={{ marginTop: 2, opacity: 0.85 }}>
            dist: {dist === null ? "-" : `${dist.toFixed(2)}m`} | k={getDistanceK().toFixed(3)}/kI={getDistanceKipd().toFixed(3)} | ipd={snap.eyeDist.toFixed(3)} | c=2m校正
          </div>
          <div style={{ marginTop: 6 }}>
            <BevMap trackerRef={props.trackerRef} visible />
          </div>
        </div>
      )}
    </>
  );
}

const btnBase: CSSProperties = {
  color: "#fff",
  border: "none",
  cursor: "pointer",
};

const callBtnStyle: CSSProperties = {
  ...btnBase,
  position: "absolute",
  bottom: 16,
  left: "50%",
  transform: "translateX(-50%)",
  padding: "10px 20px",
  fontSize: 14,
  background: "#8b5cf6",
  borderRadius: 8,
};

const convPanelStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(480px, 90vw)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  zIndex: 20,
};

const convBtnStyle: CSSProperties = {
  ...btnBase,
  padding: "10px 20px",
  fontSize: 14,
  borderRadius: 8,
  fontWeight: "bold",
};

const hudStyle: CSSProperties = {
  position: "absolute",
  bottom: 12,
  left: 12,
  padding: "6px 12px",
  background: "rgba(0,0,0,0.7)",
  borderRadius: 6,
  fontSize: 13,
  color: "#0f8",
  fontFamily: "monospace",
  pointerEvents: "none",
};
