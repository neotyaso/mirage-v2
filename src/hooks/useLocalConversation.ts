import { useCallback, useRef, useState } from "react";
import { fetchOllamaChat } from "./conversation/llm";
import type { ChatMessage } from "./conversation/llm";
import { transcribeOnce } from "./conversation/stt";

// ローカル会話ループ: Web Speech STT → Ollama LLM → (呼び出し側) TTS
// Gemini接続失敗時のフォールバックとして App から起動する。

const SYSTEM_PROMPT =
  "あなたは展示ブースの明るい受付嬢レムです。日本語で、短く元気に話します。" +
  "一文は40文字以内。相手の話に具体的に反応し、質問で会話を続けます。";

export type LocalConvState = "idle" | "listening" | "thinking" | "speaking";
export interface LocalLogEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
}

export function useLocalConversation(speak: (text: string) => Promise<void>) {
  const [state, setState] = useState<LocalConvState>("idle");
  const [log, setLog] = useState<LocalLogEntry[]>([]);

  const historyRef = useRef<ChatMessage[]>([]);
  const activeRef = useRef(false);
  const logIdRef = useRef(0);
  // speakの世代。stop/resetで古い発話を後から喋らせない用
  const epochRef = useRef(0);

  const pushLog = useCallback((role: LocalLogEntry["role"], text: string) => {
    setLog((prev) => [...prev, { id: logIdRef.current++, role, text }]);
  }, []);

  const loop = useCallback(async () => {
    const epoch = epochRef.current;
    while (activeRef.current && epoch === epochRef.current) {
      setState("listening");
      const text = await transcribeOnce(8000);
      if (!activeRef.current || epoch !== epochRef.current) break;
      if (!text) {
        // 権限拒否等で即nullが返るとCPUスピンするため軽く間を空ける
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      pushLog("user", text);
      historyRef.current.push({ role: "user", content: text });

      setState("thinking");
      try {
        const reply = await fetchOllamaChat(historyRef.current, new AbortController().signal);
        if (!activeRef.current || epoch !== epochRef.current) break;
        if (reply) {
          pushLog("assistant", reply);
          historyRef.current.push({ role: "assistant", content: reply });
          setState("speaking");
          await speak(reply);
        }
      } catch {
        // Ollama不通 → 次ターンで再試行（ループ継続）
      }
      if (!activeRef.current || epoch !== epochRef.current) break;
    }
    if (epoch === epochRef.current) setState("idle");
  }, [pushLog, speak]);

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    if (historyRef.current.length === 0) {
      historyRef.current = [{ role: "system", content: SYSTEM_PROMPT }];
    }
    void loop();
  }, [loop]);

  const stop = useCallback(() => {
    activeRef.current = false;
    epochRef.current++;
    setState("idle");
  }, []);

  const reset = useCallback(() => {
    historyRef.current = [];
    setLog([]);
    logIdRef.current = 0;
  }, []);

  return { state, log, start, stop, reset };
}
