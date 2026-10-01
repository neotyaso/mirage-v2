import { Suspense, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Avatar } from "./components/Avatar";
import { OffAxisCamera, CAM_BASE } from "./components/OffAxisCamera";
import { DebugPanel } from "./components/DebugPanel";
import { ChatLog } from "./components/ChatLog";
import { FallbackBanner } from "./components/FallbackBanner";
import { StartOverlay } from "./components/StartOverlay";
import { useFaceDetection } from "./hooks/useFaceDetection";
import { useConversationEngine, CONVERSATION_START_LINES } from "./hooks/useConversationEngine";
import { useVisitorLoop } from "./hooks/useVisitorLoop";
import { speak, useVoiceWarmup } from "./hooks/conversation/tts";

// S2Sモデルが割り込み・視線を扱うため手書き反応は撤去(P8方針)
// 呼び込みセリフも破棄（近づいたら会話開始だけで足りる）

// Appは「繋ぐ」だけ: 目・耳口・体を用意し、refで共有する。
// カメラ演出=components/OffAxisCamera、会話管理=hooks/useConversationEngine、
// 距離判断=hooks/useVisitorLoop、デバッグUI=components/DebugPanel、発話=hooks/conversation/tts。
export default function App() {
  const speakingRef = useRef(false);
  const volumeRef = useRef(0);

  const { videoRef, presentRef, faceCountRef, faceCenterRef, eyeCenterRef, faceSizeRef, eyeDistanceRef, ready: camReady, error: camError } =
    useFaceDetection();

  const eng = useConversationEngine(speakingRef, volumeRef);

  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);

  useVoiceWarmup();

  function say(text: string) {
    speak(text, speakingRef, volumeRef);
  }

  useVisitorLoop({
    started,
    paused,
    eng,
    presentRef,
    faceSizeRef,
    eyeDistanceRef,
    speakingRef,
    say,
  });

  function handleStart() {
    setStarted(true);
    say(CONVERSATION_START_LINES[Math.floor(Math.random() * CONVERSATION_START_LINES.length)]); // 音声解放を兼ねた初回発話
    // 展示用: ブラウザのタブ・ブックマーク・URLバーを隠して没入感を上げる。
    // 全画面APIはユーザー操作(このボタン押下)を起点にしないと拒否されるため、ここで呼ぶ
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function togglePause() {
    if (paused) {
      setPaused(false);
    } else {
      setPaused(true);
      eng.suspend();
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas camera={{ position: CAM_BASE, fov: 35 }}>
        {/* 背景は作り直し中のため無地。新背景は後で決める */}
        <color attach="background" args={["#ffffff"]} />

        <ambientLight intensity={0.9} />
        <directionalLight position={[2, 4, 3]} intensity={1.4} />
        <directionalLight position={[-3, 2, -2]} intensity={0.4} />

        <OffAxisCamera faceCenterRef={faceCenterRef} />

        <Suspense fallback={null}>
          <Avatar speakingRef={speakingRef} volumeRef={volumeRef} faceCenterRef={faceCenterRef} eyeCenterRef={eyeCenterRef} paused={paused} />
        </Suspense>
      </Canvas>

      {/* 会話ログ（左側に流れるチャット） */}
      {started && <ChatLog log={eng.displayLog} />}

      {/* 接続失敗の明示表示（HUDとは別に常時可視） */}
      {started && eng.failureNotice && (
        <FallbackBanner notice={eng.failureNotice} onRetry={() => { eng.connect(); }} />
      )}

      {!started ? (
        <StartOverlay onStart={handleStart} />
      ) : null}

      <DebugPanel
        videoRef={videoRef}
        presentRef={presentRef}
        faceCountRef={faceCountRef}
        faceSizeRef={faceSizeRef}
        eyeDistanceRef={eyeDistanceRef}
        camReady={camReady}
        camError={camError}
        started={started}
        paused={paused}
        eng={eng}
        onTogglePause={togglePause}
      />
    </div>
  );
}
