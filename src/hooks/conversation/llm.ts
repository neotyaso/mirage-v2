// ローカルLLMフォールバック: Ollama Chat
// Gemini接続失敗時などに使う。事前に `ollama run <model>` を起動しておくこと。

const OLLAMA_URL = "/ollama";
const OLLAMA_MODEL = "gemma4:e4b";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

// Ollama は非ストリーミングで全文を返す（思考過程は無効）
export async function fetchOllamaChat(
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      think: false,
    }),
    signal,
  });
  if (!res.ok) return "";
  const data = await res.json();
  return data.message?.content ?? "";
}
