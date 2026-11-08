import { useEffect, useRef } from "react";

export interface ChatEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
}

// 会話ログ（左側に流れるチャット）。増えたら自動で最下部へスクロールする。
export function ChatLog({
  log,
  thinking = false,
}: {
  log: ChatEntry[];
  thinking?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [log, thinking]);

  if (log.length === 0 && !thinking) return null;

  return (
    <div
      className="chat-log"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="会話ログ"
    >
      {log.map((entry) => (
        <div key={entry.id} className={`chat-bubble ${entry.role}`}>
          <span className="chat-sender">
            {entry.role === "user" ? "あなた" : "レム"}
          </span>
          {entry.text}
        </div>
      ))}
      {thinking && (
        <div className="chat-bubble assistant" aria-label="考え中">
          <span className="chat-sender">レム</span>
          <span className="chat-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
