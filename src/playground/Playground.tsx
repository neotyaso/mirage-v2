import { Suspense, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Avatar } from "../components/Avatar";
import { useFaceDetection } from "../hooks/useFaceDetection";
import type { FaceCenter } from "../hooks/useFaceDetection";
import { generateVisionComment } from "../vision/visionComment";
import { createVisitorTracker } from "../tracking/visitorTracker";
import type { VisitorTracker } from "../tracking/visitorTracker";
import { BevMap } from "../components/BevMap";
import { ChatLog } from "../components/ChatLog";
import { useConversationEngine } from "../hooks/useConversationEngine";

// 試験用ページ。Avatarが実際に参照するものだけ渡す
export function Playground() {
  const speakingRef = useRef(false);
  const volumeRef = useRef(0);
  const eng = useConversationEngine(speakingRef, volumeRef);
  const faceCenterRef = useRef<FaceCenter | null>({ x: 0.5, y: 0.5 });
  const eyeCenterRef = useRef<FaceCenter | null>(null);

  const [gaze, setGaze] = useState<FaceCenter>({ x: 0.5, y: 0.5 });
  const [panelVisible, setPanelVisible] = useState(true);

  const [cameraOn, setCameraOn] = useState(false);
  const cam = useFaceDetection(cameraOn);

  // BEV俯瞰デモ：実物のBevMapにモック2人分を給餌（カメラ不要）
  const mockTrackerRef = useRef<VisitorTracker | null>(null);
  if (mockTrackerRef.current === null) mockTrackerRef.current = createVisitorTracker();
  const [bevDemo, setBevDemo] = useState(false);
  useEffect(() => {
    if (!bevDemo) return;
    const t0 = performance.now();
    const id = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      mockTrackerRef.current?.update([
        { x: 0.75 - 0.2 * Math.min(1, t / 12), y: 0.5, size: 0.2, d: Math.max(1.0, 4.5 - t * 0.3) },
        { x: 0.3 + 0.08 * Math.sin(t * 0.8), y: 0.5, size: 0.15, d: 2.5 + 0.5 * Math.sin(t * 0.4) },
      ], performance.now());
    }, 250);
    return () => clearInterval(id);
  }, [bevDemo]);

  const [visionText, setVisionText] = useState<string>("");
  const [visionLoading, setVisionLoading] = useState(false);
  async function testVision() {
    setVisionLoading(true);
    setVisionText("");
    const t0 = performance.now();
    const comment = await generateVisionComment(cam.videoRef.current);
    const ms = Math.round(performance.now() - t0);
    setVisionText(comment ? `「${comment}」 (${ms}ms)` : `SKIP/失敗 (${ms}ms)`);
    setVisionLoading(false);
  }

  // カメラONの間、実検出値をAvatar出力refへ同期する。OFFの間は手動スライダーが効く
  useEffect(() => {
    if (!cameraOn) return;
    const id = setInterval(() => {
      faceCenterRef.current = cam.faceCenterRef.current;
      eyeCenterRef.current = cam.eyeCenterRef.current;
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  function setGazeField(k: keyof FaceCenter, v: number) {
    const next = { ...gaze, [k]: v };
    setGaze(next);
    faceCenterRef.current = next;
    eyeCenterRef.current = null;
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#ffffff" }}>
      <Canvas camera={{ position: [0, 1.1, 3], fov: 35 }}>
        <color attach="background" args={["#ffffff"]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[2, 4, 3]} intensity={1.4} />
        <directionalLight position={[-3, 2, -2]} intensity={0.4} />

        <OrbitControls target={[0, 1, 0]} />

        <Suspense fallback={null}>
          <Avatar
            speakingRef={speakingRef}
            volumeRef={volumeRef}
            faceCenterRef={faceCenterRef}
            eyeCenterRef={eyeCenterRef}
          />
        </Suspense>
      </Canvas>

      {eng.displayLog.length > 0 && <ChatLog log={eng.displayLog} />}

      <video
        ref={cam.videoRef}
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
          border: "2px solid #333",
          borderRadius: 6,
          zIndex: 10,
          visibility: cameraOn ? "visible" : "hidden",
        }}
      />

      <button
        onClick={() => setPanelVisible((v) => !v)}
        style={{ ...btnStyle, position: "absolute", top: 12, left: 12, zIndex: 20, background: "#374151" }}
      >
        {panelVisible ? "✕ 隠す" : "☰ パネル表示"}
      </button>

      <div style={{ ...panelStyle, display: panelVisible ? "flex" : "none", paddingTop: 44 }}>
        <div style={rowStyle}>
          <span style={labelStyle}>カメラ（実顔検出→注視）</span>
          <button onClick={() => setCameraOn((v) => !v)} style={{ ...btnStyle, background: cameraOn ? "#ef4444" : "#374151" }}>
            {cameraOn ? "■ カメラOFF" : "▶ カメラON"}
          </button>
          {cameraOn && (
            <span style={{ fontSize: 11, opacity: 0.7 }}>
              {cam.error ? `ERR ${cam.error}` : cam.ready ? "ok" : "…"}
            </span>
          )}
        </div>
        {cameraOn && (
          <div style={rowStyle}>
            <span style={labelStyle}>視覚コメント（「私、見えてるよ」テスト）</span>
            <button onClick={testVision} disabled={visionLoading} style={{ ...btnStyle, background: visionLoading ? "#6b7280" : "#374151" }}>
              {visionLoading ? "生成中…" : "📷 見た目に一言"}
            </button>
            {visionText && <span style={{ fontSize: 12, opacity: 0.85 }}>{visionText}</span>}
          </div>
        )}

        <div style={rowStyle}>
          <span style={labelStyle}>Gemini会話（本番と同一engine・リップシンク連動）</span>
          <button onClick={eng.toggleConversation} style={{ ...btnStyle, background: eng.activeConvState === "idle" ? "#8b5cf6" : "#ef4444" }}>
            {eng.activeConvState === "idle" ? "🎤 会話開始" : eng.activeConvState === "listening" ? "👂 聴いてる…" : eng.activeConvState === "thinking" ? "💭 考え中…" : "🔊 喋ってる"}
          </button>
          <span style={{ fontSize: 11, opacity: 0.7 }}>
            {eng.engine} | {eng.geminiState} | turns={eng.geminiMetrics.turns}
          </span>
          {eng.failureNotice && <span style={{ fontSize: 11, color: "#fbbf24" }}>{eng.failureNotice}</span>}
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>BEV俯瞰デモ（モック2人・実物BevMap）</span>
          <button onClick={() => setBevDemo((v) => !v)} style={{ ...btnStyle, background: bevDemo ? "#ef4444" : "#374151" }}>
            {bevDemo ? "■ BEV停止" : "▶ BEV表示"}
          </button>
          {bevDemo && <BevMap trackerRef={mockTrackerRef} visible={bevDemo} />}
        </div>
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px 14px",
  background: "rgba(0,0,0,0.65)",
  borderRadius: 10,
  color: "#fff",
  fontFamily: "sans-serif",
  fontSize: 13,
  minWidth: 260,
  maxHeight: "calc(100vh - 24px)",
  overflowY: "auto",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const labelStyle: CSSProperties = {
  opacity: 0.8,
  fontSize: 12,
};

const btnStyle: CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};
