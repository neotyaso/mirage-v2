import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Avatar } from "./components/Avatar";
import { CALLOUT_POOLS, groupize } from "./vision/callDecision";
import { useFaceDetection, getDistanceZone, estimateDistanceM, getDistanceK, getDistanceKipd, calibrateDistanceAt } from "./hooks/useFaceDetection";
import type { FaceCenter, DistanceZone } from "./hooks/useFaceDetection";
import { useGeminiLive } from "./hooks/useGeminiLive";
import { useLocalConversation } from "./hooks/useLocalConversation";
import { isLocalSttSupported } from "./hooks/conversation/stt";
import { speakAndWait, waitUntilNotSpeaking } from "./hooks/conversation/tts";
import type { RefObject } from "react";

// Off-axis カメラ: 来場者の顔位置でカメラが動く
const CAM_BASE: [number, number, number] = [0, 1.1, 3];
const CAM_RANGE_X = 0.8; // 顔が端にいると左右±0.8m動く
const CAM_RANGE_Y = 0.35;
const CAM_LERP = 0.06; // 追従の滑らかさ（小さいほど遅れる）

function OffAxisCamera({ faceCenterRef }: { faceCenterRef: RefObject<FaceCenter | null> }) {
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

// 呼び込みセリフは src/vision/callDecision.ts のCALLOUT_POOLSに一本化。
// 複数人時はgroupizeで寄せる(「あなた」→「みんな」)。

// 遠いほど頻繁に呼び込む
const COOLDOWN: Record<Exclude<DistanceZone, "absent">, number> = {
  far: 4000,
  mid: 6000,
  near: 9000,
};

// 初回の「気づいた」呼び込み(チャイム+呼び込み声)は、far到達で即座には鳴らさない。
// Avatar.tsx側の「チラ見」演出(farではまだ気づいてないフリを続ける)と足並みを揃えるため、
// mid/nearまで寄ってきたら即座に、farのまま粘る場合だけこの時間だけ待ってから鳴らす
// （放置しすぎると遠くの通行人を完全に無視することになるための保険。呼び込み自体は展示の
// 核なので、farで無音のままにするのは誤りだった＝一度削除して復元した経緯あり）
const GREET_FALLBACK_MS = 4000;
const AWAY_TIMEOUT_MS = 4000; // これだけ不在が続いたら「離れた」と判断（顔検出の一瞬の途切れで切れないように）

// 会話モードが始まった瞬間に必ず言う一言。会話開始後はレムは黙って聞く設計なので、
// これが無いと来場者から「近づいたのに何も起きない」ように見えてしまう
const CONVERSATION_START_LINES = [
  "うんうん、何か話してよ！",
  "よし、聞く準備できたよ！",
  "さあさあ、何でも聞かせて！",
];

// 離脱時の別れの一言（実際に会話してた場合のみ発話。呼び込みだけで素通りされた時は言わない）
const FAREWELL_LINES = [
  "またね〜！話せて楽しかった！",
  "ありがとうね！気をつけて帰ってね！",
  "えー、もう行っちゃうの！？また来てよね！",
];

// S2Sモデルが割り込み・視線を扱うため手書き反応は撤去(P8方針)
export default function App() {
  const speakingRef = useRef(false);
  const volumeRef = useRef(0);

  const { videoRef, presentRef, faceCountRef, faceCenterRef, eyeCenterRef, faceSizeRef, eyeDistanceRef, ready: camReady, error: camError } =
    useFaceDetection();

  type GeminiContract = ReturnType<typeof useGeminiLive> & Partial<{
    log: { id: number; role: "user" | "assistant"; text: string }[];
    resetTranscript: () => void;
    metrics: { connectMs: number | null; firstAudioMs: number | null; turns: number; disconnects: number };
  }>;
  const geminiRaw = useGeminiLive() as GeminiContract;
  const geminiState = geminiRaw.state;
  const geminiMetrics = geminiRaw.metrics ?? { connectMs: null, firstAudioMs: null, turns: 0, disconnects: 0 };
  const geminiResetTranscript = geminiRaw.resetTranscript ?? (() => {});
  const geminiActive = geminiState !== "disconnected" && geminiState !== "error";

  // 会話エンジン: gemini=本線(Gemini Live S2S)、local=フォールバック(Web Speech STT + Ollama + Web Speech読み上げ)。
  // テスト: http://localhost:5173/?engine=local でフォールバックを強制
  const [engine, setEngine] = useState<"gemini" | "local">(
    new URLSearchParams(location.search).get("engine") === "local" ? "local" : "gemini",
  );
  const engineRef = useRef(engine);
  engineRef.current = engine;

  // ローカル会話の発話はtts.ts側(speakAndWait)。喋り終わりまで待って次ターンへ
  const local = useLocalConversation(useCallback((t: string) =>
    speakAndWait(t, speakingRef, volumeRef, 15000), []));
  const localRef = useRef(local);
  localRef.current = local;
  // 離脱/一時停止時に pending の local.start() を打ち消す用
  const localWantedRef = useRef(false);

  const displayLog = engine === "local" ? local.log : geminiRaw.log ?? [];
  const activeConvState =
    engine === "local"
      ? local.state
      : geminiState === "speaking"
        ? "speaking"
        : geminiState === "connecting"
          ? "thinking"
          : geminiActive
            ? "listening"
            : ("idle" as const);

  function startLocalConv() {
    if (localWantedRef.current) return;
    localWantedRef.current = true;
    // 開始一言(speak)がマイクに漏れるので再生完了後にlisten開始
    void waitUntilNotSpeaking(speakingRef, 8000).then(() => {
      if (localWantedRef.current) localRef.current.start();
    });
  }

  function stopLocalConv(reset: boolean) {
    localWantedRef.current = false;
    localRef.current.stop();
    if (reset) localRef.current.reset();
  }

  // 接続リトライ: キー未設定・connect失敗・error状態・会話中の異常切断。
  // 指数バックオフ(1s,2s)で最大3回。失敗時はローカル会話へ自動切替。
  const [failureNotice, setFailureNotice] = useState<string | null>(null);
  const geminiFailCountRef = useRef(0);
  const geminiRetryingRef = useRef(false);
  const geminiIntentionalRef = useRef(false); // 離脱・停止時の意図的disconnectを異常と誤認しない用
  const prevDisconnectsRef = useRef(geminiMetrics.disconnects);
  const geminiMetricsRef = useRef(geminiMetrics);
  geminiMetricsRef.current = geminiMetrics;

  function stopAppAudio() {
    speechSynthesis.cancel();
    speakingRef.current = false;
    volumeRef.current = 0;
  }

  function intentionalGeminiDisconnect(disconnect?: () => void) {
    geminiIntentionalRef.current = true;
    if (disconnect) { try { disconnect(); } catch { /* ignore */ } }
    setTimeout(() => { geminiIntentionalRef.current = false; }, 1000);
  }

  async function connectGeminiRobust() {
    if (geminiRetryingRef.current) return;
    if (geminiRaw.state !== "disconnected" && geminiRaw.state !== "error") return;
    geminiRetryingRef.current = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await geminiConnectRef.current();
          geminiFailCountRef.current = 0;
          setFailureNotice(null);
          if (engineRef.current === "local") {
            stopLocalConv(true);
            setEngine("gemini");
          }
          return;
        } catch (e) {
          geminiFailCountRef.current++;
          console.error(`[Gemini] connect failed (attempt ${attempt + 1}/3):`, e);
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); // 1s, 2s
          }
        }
      }
      if (isLocalSttSupported()) {
        setFailureNotice(`Gemini接続に3回失敗 → ローカル会話へ切替 (disconnects=${geminiMetricsRef.current.disconnects})`);
        setEngine("local");
      } else {
        setFailureNotice(`Gemini接続に3回失敗 & このブラウザはSTT非対応 (disconnects=${geminiMetricsRef.current.disconnects})`);
      }
    } finally {
      geminiRetryingRef.current = false;
    }
  }
  const connectGeminiRobustRef = useRef(() => Promise.resolve());
  connectGeminiRobustRef.current = connectGeminiRobust;

  // セッション有効時のみ speakingRef/volumeRef を橋渡し。
  // disconnected/error時は触らない（開始・別れの一言のspeak()=Web Speech駆動のリップシンクを殺さないため）。
  const geminiMicLevel = geminiRaw.micLevel;
  const geminiOutLevel = geminiRaw.outLevel;
  useEffect(() => {
    if (!geminiActive) return;
    if (geminiState === "speaking") {
      speakingRef.current = true;
      volumeRef.current = geminiOutLevel;
    } else {
      speakingRef.current = false;
      volumeRef.current = geminiMicLevel * 0.3;
    }
  }, [geminiActive, geminiState, geminiMicLevel, geminiOutLevel]);

  // error状態・異常切断を検知してリトライ経路へ回す。
  // 意図的disconnectはhook側でattemptが進むためmetrics.disconnectsが増えないが、
  // 念のためgeminiIntentionalRefでも除外する。
  useEffect(() => {
    if (engine === "local") return; // ローカル会話中は自動再接続しない（バナーの手動復帰のみ）
    if (geminiRetryingRef.current) {
      prevDisconnectsRef.current = geminiMetrics.disconnects;
      return;
    }
    if (geminiState === "error") {
      prevDisconnectsRef.current = geminiMetrics.disconnects;
      void connectGeminiRobustRef.current();
      return;
    }
    if (geminiMetrics.disconnects > prevDisconnectsRef.current) {
      prevDisconnectsRef.current = geminiMetrics.disconnects;
      if (geminiIntentionalRef.current) return;
      void connectGeminiRobustRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, geminiState, geminiMetrics.disconnects]);

  const logEndRef = useRef<HTMLDivElement>(null);

  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [present, setPresent] = useState(false);
  const [faces, setFaces] = useState(0);
  const [zone, setZone] = useState<DistanceZone>("absent");
  const [debugMode, setDebugMode] = useState(false); // 展示本番では隠す。"d"キーで表示切り替え
  const [curFaceSize, setCurFaceSize] = useState(0); // HUD表示用の現在の顔幅（閾値合わせの目安）。
  const [curEyeDist, setCurEyeDist] = useState(0); // HUD表示用の眼間距離(IPD)。

  // "d"キーでデバッグUI（小窓カメラ・HUD・手動操作ボタン）の表示を切り替え。
  // 展示当日の距離合わせは校正キー:
  //   c     : 設置時1点校正。今映っている顔を2mとみなして k = 2*faceSize を保存
  const faceSizeRefForCalib = useRef(0);
  const eyeDistRefForCalib = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "d") { setDebugMode((v) => !v); return; }
      if (!debugMode) return; // 校正はデバッグHUD表示中のみ受け付ける（本番中の誤爆防止）
      if (e.key === "c") { calibrateDistanceAt(faceSizeRefForCalib.current, 2, eyeDistRefForCalib.current); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [debugMode]);

  // チャットログが増えたら自動で最下部へスクロール（エンジン側の表示ログに追従）
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayLog]);

  // Web Speech API フォールバック用
  useEffect(() => {
    const sync = () => speechSynthesis.getVoices();
    sync();
    speechSynthesis.onvoiceschanged = sync;
    return () => { speechSynthesis.onvoiceschanged = null; };
  }, []);

  // 発話はWeb Speech。呼び込み・見た目コメント・開始/別れの一言用。
  // 会話本体の声はGemini Live(Zephyr)。前の発話が残っていたら止めてから喋る。
  function speak(text: string) {
    stopAppAudio();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP"; u.rate = 1.05; u.pitch = 1.2;
    const jp = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja"));
    if (jp) u.voice = jp;
    u.onstart = () => { speakingRef.current = true; volumeRef.current = 0.6; };
    u.onend = () => { speakingRef.current = false; volumeRef.current = 0; };
    u.onerror = () => { speakingRef.current = false; volumeRef.current = 0; };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function callOut(z: Exclude<DistanceZone, "absent">) {
    const pool = CALLOUT_POOLS[z];
    const text = pool[Math.floor(Math.random() * pool.length)];
    speak(faceCountRef.current >= 2 ? groupize(text) : text);
  }

  // 自動呼び込み制御：距離ゾーンに応じてセリフ・クールダウンを変える
  const lastCall = useRef(0);
  const wasPresent = useRef(false);
  // mid/nearまで近づいたら自動で会話モードON。離れたら自動でOFF＋次の来場者のため履歴リセット
  const lastPresentAtRef = useRef(performance.now());
  // 会話中に相手の顔検出が一瞬途切れて自動リセットされた直後の復帰では、
  // 「新規来場者」扱いの呼び込みセリフを鳴らさず静かに会話を再開する（2人目が現れて一瞬顔が隠れた時などに
  // 「ねえねえ話していかない？」が会話に割り込む不自然さを防ぐ）
  const silentResumeRef = useRef(false);
  // 今回の来場者に対して「気づいた」呼び込み(チャイム+声)をもう鳴らしたか。新規来場でリセットされる
  const hasGreetedRef = useRef(false);
  const firstSeenAtRef = useRef(0); // 今回の来場者を検知し始めた時刻（GREET_FALLBACK_MSの起点）
  // interval内から呼ぶGemini操作はref経由（micLevel更新のたびにobject同一性が変わるため、
  // クロージャで直接掴むとintervalが作り直され続けるのを避ける）
  const geminiConnectRef = useRef(geminiRaw.connect);
  geminiConnectRef.current = geminiRaw.connect;
  const geminiDisconnectRef = useRef(geminiRaw.disconnect);
  geminiDisconnectRef.current = geminiRaw.disconnect;
  const geminiResetRef = useRef(geminiResetTranscript);
  geminiResetRef.current = geminiResetTranscript;
  // 実際に会話ログがあるか（離脱時の別れの一言を言うか判定用）。
  // setInterval側のクロージャがconvState変化時にしか作り直されず、logの更新を都度拾えないためrefで同期する
  const hasLogRef = useRef(false);
  useEffect(() => {
    hasLogRef.current = displayLog.length > 0;
  }, [displayLog]);
  useEffect(() => {
    const id = setInterval(() => {
      const p = presentRef.current;
      const z = getDistanceZone(faceSizeRef.current, eyeDistanceRef.current);
      setPresent(p);
      setFaces(faceCountRef.current);
      setZone(z);
      setCurFaceSize(faceSizeRef.current);
      setCurEyeDist(eyeDistanceRef.current);
      faceSizeRefForCalib.current = faceSizeRef.current;
      eyeDistRefForCalib.current = eyeDistanceRef.current;

      if (started && !paused && p && z !== "absent" && !speakingRef.current && activeConvState === "idle") {
        const now = performance.now();
        if (silentResumeRef.current) {
          silentResumeRef.current = false;
        } else {
          // 不在→在 の瞬間、新規来場者としてリセット
          const isNewArrival = !wasPresent.current;
          if (isNewArrival) {
            hasGreetedRef.current = false;
            firstSeenAtRef.current = now;
          }

          if (!hasGreetedRef.current) {
            // まだ「気づいた」呼び込みをしていない来場者。mid/nearまで寄ってきたら即座に、
            // farのまま粘る場合はGREET_FALLBACK_MSだけ待ってから、初回の気づき(チャイム+呼び込み)を鳴らす。
            const reachedInteractive = z === "mid" || z === "near";
            if (
              (reachedInteractive || now - firstSeenAtRef.current > GREET_FALLBACK_MS) &&
              now - lastCall.current > 1500 // 連打防止（最低1.5秒）
            ) {
              // 気づきの呼び込みを鳴らす
              callOut(z);
              lastCall.current = now;
              hasGreetedRef.current = true;
            }
          } else if (z === "far" && now - lastCall.current > COOLDOWN[z] && now - lastCall.current > 1500) {
            // 気づき済み後もfarのまま粘る来場者にだけ、クールダウンで呼び込みを繰り返す。
            // mid/nearは会話が自動で始まる/再開するので、
            // ここで改めて「ねえねえ」系の呼び込みを繰り返す必要はない
            callOut(z);
            lastCall.current = now;
          }
        }
      }
      wasPresent.current = p;

      if (p) lastPresentAtRef.current = performance.now();
      if (started && !paused) {
        if ((z === "mid" || z === "near") && activeConvState === "idle") {
          // 会話モードは開始しても来場者が話すまでレムは黙って聞くだけの設計だが、それだと
          // 「近づいたのに何も起きない＝壊れてる？」と感じられてしまう。会話開始の瞬間は必ず
          // 一言喋って「聞く態勢に入った」ことを分かりやすくする（呼び込みの通常クールダウンとは別枠）
          speak(CONVERSATION_START_LINES[Math.floor(Math.random() * CONVERSATION_START_LINES.length)]);
          if (engineRef.current === "local") {
            if (!localWantedRef.current) startLocalConv();
          } else {
            void connectGeminiRobustRef.current();
          }
        }
        if (activeConvState !== "idle" && performance.now() - lastPresentAtRef.current > AWAY_TIMEOUT_MS) {
          // 実際にやり取りがあった（ログが残っている）場合だけ別れの一言を挟む。
          // 呼び込みだけで素通りされた時にまで「またね」と言うと不自然なので
          if (hasLogRef.current) {
            speak(FAREWELL_LINES[Math.floor(Math.random() * FAREWELL_LINES.length)]);
          }
          stopLocalConv(true);
          intentionalGeminiDisconnect(() => geminiDisconnectRef.current());
          geminiResetRef.current();
          silentResumeRef.current = true;
        }
      }
    }, 150);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, paused, activeConvState]);

  function handleStart() {
    setStarted(true);
    callOut("mid"); // 音声解放を兼ねた初回発話
    lastCall.current = performance.now();
    // 展示用: ブラウザのタブ・ブックマーク・URLバーを隠して「窓の中の別世界」への没入感を上げる。
    // 全画面APIはユーザー操作(このボタン押下)を起点にしないと拒否されるため、ここで呼ぶ
    document.documentElement.requestFullscreen?.().catch(() => {});
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
      {started && displayLog.length > 0 && (
        <div style={chatLogStyle}>
          {displayLog.map((entry) => (
            <div key={entry.id} style={chatBubbleStyle(entry.role)}>
              <div style={chatSenderStyle}>{entry.role === "user" ? "あなた" : "レム"}</div>
              {entry.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* 接続失敗の明示表示（HUDとは別に常時可視） */}
      {started && failureNotice && (
        <div style={fallbackBannerStyle}>
          <span>⚠ {failureNotice}</span>
          <button style={fallbackBackBtnStyle} onClick={() => { void connectGeminiRobustRef.current(); }}>
            Geminiへ復帰
          </button>
        </div>
      )}

      {/* 検出用カメラ（顔検出が参照する実体なので常時マウント。展示中は"d"キーを押すまで非表示） */}
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
          border: present ? "2px solid #0f8" : "2px solid #333",
          borderRadius: 6,
          zIndex: 10,
          visibility: debugMode ? "visible" : "hidden",
        }}
      />

      {!started ? (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, zIndex: 30 }}>
          <button style={{ ...startBtnStyle, position: "static", transform: "none" }} onClick={handleStart}>
            ▶ 展示スタート
          </button>
        </div>
      ) : debugMode ? (
        <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8 }}>
          {activeConvState === "idle" && (
            <button style={callBtnStyle} onClick={() => callOut(zone !== "absent" ? zone : "mid")}>
              🔊 手動呼び込み
            </button>
          )}
          <button
            style={{ ...callBtnStyle, background: paused ? "#22c55e" : "#ef4444" }}
            onClick={() => {
              if (paused) {
                setPaused(false);
              } else {
                setPaused(true);
                // 呼び込み等のセリフ再生中は明示的に止める
                stopAppAudio();
                stopLocalConv(false);
                if (geminiActive) {
                  intentionalGeminiDisconnect(() => geminiDisconnectRef.current());
                }
              }
            }}
          >
            {paused ? "▶ 再開" : "⏸ 停止"}
          </button>
        </div>
      ) : null}

      {/* 会話パネル（手動操作用。会話はnear接近で自動開始するので通常は不要。デバッグ時のみ表示） */}
      {started && debugMode && (
        <div style={convPanelStyle}>
          <div style={{ marginBottom: 8, display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              style={{ ...convBtnStyle, background: activeConvState === "idle" ? "#8b5cf6" : "#ef4444" }}
              onClick={() => {
                if (engine === "local") {
                  if (localWantedRef.current) stopLocalConv(false);
                  else {
                    speak(CONVERSATION_START_LINES[Math.floor(Math.random() * CONVERSATION_START_LINES.length)]);
                    startLocalConv();
                  }
                } else if (!geminiActive) {
                  speak(CONVERSATION_START_LINES[Math.floor(Math.random() * CONVERSATION_START_LINES.length)]);
                  void connectGeminiRobustRef.current();
                } else {
                  intentionalGeminiDisconnect(() => geminiDisconnectRef.current());
                }
              }}
            >
              {activeConvState === "idle" ? "🎤 会話開始" : activeConvState === "listening" ? "👂 聴いてる…" : activeConvState === "thinking" ? "💭 考え中…" : "🔊 喋ってる"}
            </button>
            <button
              style={{ ...convBtnStyle, background: "#374151" }}
              onClick={() => {
                stopLocalConv(true);
                geminiResetRef.current();
              }}
            >
              🔄 会話リセット
            </button>
          </div>
        </div>
      )}

      {debugMode && (
        <div style={hudStyle}>
          <div>
            cam: {camError ? `ERR ${camError}` : camReady ? "ok" : "…"} | 在席:{" "}
            {present ? "YES" : "no"} | 顔: {faces} | zone: {zone} | conv: {activeConvState} | {!started ? "停止中" : paused ? "一時停止中" : "稼働中"}
          </div>
          <div style={{ marginTop: 2, opacity: 0.85 }}>
            engine: {engine} | gemini: {geminiState} | via: {geminiRaw.via || "-"} | local: {local.state}
          </div>
          <div style={{ marginTop: 2, opacity: 0.85 }}>
            m: connectMs={geminiMetrics.connectMs ?? "-"} | firstAudioMs={geminiMetrics.firstAudioMs ?? "-"} | turns={geminiMetrics.turns} | disconnects={geminiMetrics.disconnects}
          </div>
          {failureNotice && (
            <div style={{ marginTop: 2, color: "#fbbf24" }}>
              fail: {failureNotice}
            </div>
          )}
          <div style={{ marginTop: 2, opacity: 0.85 }}>
            dist: {(() => { const d = estimateDistanceM(curFaceSize, curEyeDist); return d === null ? "-" : `${d.toFixed(2)}m`; })()} | k={getDistanceK().toFixed(3)}/kI={getDistanceKipd().toFixed(3)} | ipd={curEyeDist.toFixed(3)} | c=2m校正
          </div>
        </div>
      )}
    </div>
  );
}

const btnBase: CSSProperties = {
  color: "#fff",
  border: "none",
  cursor: "pointer",
};

const startBtnStyle: CSSProperties = {
  ...btnBase,
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  padding: "16px 36px",
  fontSize: 18,
  fontWeight: "bold",
  background: "#8b5cf6",
  borderRadius: 12,
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

const fallbackBannerStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  maxWidth: "min(360px, 80vw)",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 12px",
  background: "#7c2d12",
  borderRadius: 8,
  fontSize: 12,
  color: "#fef3c7",
  zIndex: 25,
};

const fallbackBackBtnStyle: CSSProperties = {
  ...btnBase,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: "bold",
  background: "#8b5cf6",
  borderRadius: 6,
  whiteSpace: "nowrap",
};

const chatLogStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  bottom: 72,
  width: "min(320px, 80vw)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  overflowY: "auto",
  zIndex: 15,
  padding: "4px 2px",
  scrollbarWidth: "thin",
};

const chatSenderStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.7,
  marginBottom: 2,
  fontWeight: "bold",
};

const chatBubbleStyle = (role: "user" | "assistant"): CSSProperties => ({
  alignSelf: role === "user" ? "flex-end" : "flex-start",
  maxWidth: "88%",
  padding: "8px 12px",
  borderRadius: 12,
  fontSize: 13,
  lineHeight: 1.4,
  color: "#fff",
  background: role === "user" ? "#374151" : "#8b5cf6",
  textAlign: "left",
});

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
