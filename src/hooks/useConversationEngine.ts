import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useGeminiLive } from "./useGeminiLive";
import { useLocalConversation } from "./useLocalConversation";
import { isLocalSttSupported } from "./conversation/stt";
import { speak, speakAndWait, stopAppAudio, waitUntilNotSpeaking } from "./conversation/tts";

// 会話モードが始まった瞬間に必ず言う一言。会話開始後はレムは黙って聞く設計なので、
// これが無いと来場者から「近づいたのに何も起きない」ように見えてしまう
export const CONVERSATION_START_LINES = [
  "うんうん、何か話してよ！",
  "よし、聞く準備できたよ！",
  "さあさあ、何でも聞かせて！",
];

// 離脱時の別れの一言（実際に会話してた場合のみ発話。呼び込みだけで素通りされた時は言わない）
export const FAREWELL_LINES = [
  "またね〜！話せて楽しかった！",
  "ありがとうね！気をつけて帰ってね！",
  "えー、もう行っちゃうの！？また来てよね！",
];

export type EngineConvState = "idle" | "listening" | "thinking" | "speaking";

// 会話エンジンの選択と接続管理。
// gemini=本線(Gemini Live S2S)、local=フォールバック(Web Speech STT + Ollama + Web Speech読み上げ)。
// テスト: http://localhost:5173/?engine=local でフォールバックを強制
// 方針（どちらを使うか）はここ、距離による開始/終了の判断はAppの150msループが行う。
export function useConversationEngine(
  speakingRef: RefObject<boolean>,
  volumeRef: RefObject<number>,
) {
  const gemini = useGeminiLive();
  const geminiState = gemini.state;
  const geminiMetrics = gemini.metrics;
  const geminiActive = geminiState !== "disconnected" && geminiState !== "error";

  const [engine, setEngine] = useState<"gemini" | "local">(
    new URLSearchParams(location.search).get("engine") === "local" ? "local" : "gemini",
  );
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const geminiActiveRef = useRef(geminiActive);
  geminiActiveRef.current = geminiActive;

  // interval内から呼ぶGemini操作はref経由（micLevel更新のたびにobject同一性が変わるため、
  // クロージャで直接掴むとintervalが作り直され続けるのを避ける）
  const geminiConnectRef = useRef(gemini.connect);
  geminiConnectRef.current = gemini.connect;
  const geminiDisconnectRef = useRef(gemini.disconnect);
  geminiDisconnectRef.current = gemini.disconnect;
  const geminiResetRef = useRef(gemini.resetTranscript);
  geminiResetRef.current = gemini.resetTranscript;
  const geminiInjectRef = useRef(gemini.injectContext);
  geminiInjectRef.current = gemini.injectContext;

  // ローカル会話の発話はtts.ts側(speakAndWait)。喋り終わりまで待って次ターンへ
  const local = useLocalConversation(useCallback((t: string, onFirst?: () => void) =>
    speakAndWait(t, speakingRef, volumeRef, 15000, onFirst), [speakingRef, volumeRef]));
  const localRef = useRef(local);
  localRef.current = local;
  // 離脱/一時停止時に pending の local.start() を打ち消す用
  const localWantedRef = useRef(false);

  const displayLog = engine === "local" ? local.log : gemini.log ?? [];
  const activeConvState: EngineConvState =
    engine === "local"
      ? local.state
      : geminiState === "speaking"
        ? "speaking"
        : geminiState === "connecting"
          ? "thinking"
          : geminiActive
            ? "listening"
            : "idle";

  function startLocal(context?: string) {
    if (localWantedRef.current) return;
    localWantedRef.current = true;
    // 開始一言(speak)がマイクに漏れるので再生完了後にlisten開始
    void waitUntilNotSpeaking(speakingRef, 8000).then(() => {
      if (localWantedRef.current) localRef.current.start(context);
    });
  }

  function stopLocal(reset: boolean) {
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

  function disconnectIntentional() {
    geminiIntentionalRef.current = true;
    try { geminiDisconnectRef.current(); } catch { /* ignore */ }
    setTimeout(() => { geminiIntentionalRef.current = false; }, 1000);
  }

  async function connectRobust(context?: string) {
    if (geminiRetryingRef.current) return;
    if (gemini.state !== "disconnected" && gemini.state !== "error") return;
    geminiRetryingRef.current = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await geminiConnectRef.current(context);
          geminiFailCountRef.current = 0;
          setFailureNotice(null);
          if (engineRef.current === "local") {
            stopLocal(true);
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
  // interval・ボタンから呼ぶ操作はref経由で安定化（gemini.connectの同一性がmicLevel更新で変わるため）
  const connectRobustRef = useRef(connectRobust);
  connectRobustRef.current = connectRobust;
  const stableConnect = useCallback((context?: string) => { void connectRobustRef.current(context); }, []);
  const stableDisconnect = useCallback(() => { disconnectIntentional(); }, []);
  const stableStartLocal = useCallback((context?: string) => { startLocal(context); }, []);
  const stableStopLocal = useCallback((reset: boolean) => { stopLocal(reset); }, []);
  function injectContext(text: string) {
    if (engineRef.current === "local") localRef.current.injectContext(text);
    else if (geminiActiveRef.current) geminiInjectRef.current(text);
  }
  const stableInject = useCallback((text: string) => { injectContext(text); }, []);

  function speakStartLine() {
    speak(CONVERSATION_START_LINES[Math.floor(Math.random() * CONVERSATION_START_LINES.length)], speakingRef, volumeRef);
  }

  // 離脱時: 会話を畳んで次の来場者に備える
  function endConversation() {
    stopLocal(true);
    disconnectIntentional();
    geminiResetRef.current();
  }

  // 一時停止時: 再生中を止めて会話から抜ける（履歴は残す）
  function suspend() {
    stopAppAudio(speakingRef, volumeRef);
    stopLocal(false);
    if (geminiActiveRef.current) disconnectIntentional();
  }

  // デバッグ用リセットボタン: 会話履歴だけ捨てる
  function resetAll() {
    stopLocal(true);
    geminiResetRef.current();
  }

  // デバッグ用会話ボタン: 状態に応じた開始/切断の切り替え
  function toggleConversation() {
    if (engineRef.current === "local") {
      if (localWantedRef.current) stopLocal(false);
      else {
        speakStartLine();
        startLocal();
      }
    } else if (!geminiActiveRef.current) {
      speakStartLine();
      void connectRobustRef.current();
    } else {
      disconnectIntentional();
    }
  }
  const stableToggle = useCallback(() => { toggleConversation(); }, []);
  const stableSuspend = useCallback(() => { suspend(); }, []);
  const stableEnd = useCallback(() => { endConversation(); }, []);
  const stableResetAll = useCallback(() => { resetAll(); }, []);
  const stableSpeakStart = useCallback(() => { speakStartLine(); }, []);

  // セッション有効時のみ speakingRef/volumeRef を橋渡し。
  // disconnected/error時は触らない（開始・別れの一言のspeak()=Web Speech駆動のリップシンクを殺さないため）。
  const geminiMicLevel = gemini.micLevel;
  const geminiOutLevel = gemini.outLevel;
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
      void connectRobustRef.current();
      return;
    }
    if (geminiMetrics.disconnects > prevDisconnectsRef.current) {
      prevDisconnectsRef.current = geminiMetrics.disconnects;
      if (geminiIntentionalRef.current) return;
      void connectRobustRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, geminiState, geminiMetrics.disconnects]);

  return {
    engine,
    displayLog,
    activeConvState,
    failureNotice,
    geminiState,
    geminiMetrics,
    geminiActive,
    via: gemini.via,
    localState: local.state,
    localMetrics: local.metrics,
    localWantedRef,
    connect: stableConnect,
    disconnect: stableDisconnect,
    startLocal: stableStartLocal,
    stopLocal: stableStopLocal,
    injectContext: stableInject,
    endConversation: stableEnd,
    suspend: stableSuspend,
    resetAll: stableResetAll,
    toggleConversation: stableToggle,
    speakStartLine: stableSpeakStart,
  };
}

export type ConversationEngine = ReturnType<typeof useConversationEngine>;
