import type { CSSProperties } from "react";

export function StartOverlay({ onStart }: { onStart: () => void }) {
  return (
    <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, zIndex: 30 }}>
      <button style={startBtnStyle} onClick={onStart}>
        ▶ 展示スタート
      </button>
    </div>
  );
}

const startBtnStyle: CSSProperties = {
  color: "#fff",
  border: "none",
  cursor: "pointer",
  padding: "16px 36px",
  fontSize: 18,
  fontWeight: "bold",
  background: "#8b5cf6",
  borderRadius: 12,
};
