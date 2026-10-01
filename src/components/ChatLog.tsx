import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

export interface ChatEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
}

// 会話ログ（左側に流れるチャット）。増えたら自動で最下部へスクロールする。
export function ChatLog({ log }: { log: ChatEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  if (log.length === 0) return null;

  return (
    <div style={chatLogStyle}>
      {log.map((entry) => (
        <div key={entry.id} style={chatBubbleStyle(entry.role)}>
          <div style={chatSenderStyle}>{entry.role === "user" ? "あなた" : "レム"}</div>
          {entry.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

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
