import type { CSSProperties } from "react";

export function FallbackBanner({ notice, onRetry }: { notice: string; onRetry: () => void }) {
  return (
    <div style={fallbackBannerStyle}>
      <span>⚠ {notice}</span>
      <button style={fallbackBackBtnStyle} onClick={onRetry}>
        Geminiへ復帰
      </button>
    </div>
  );
}

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
  color: "#fff",
  border: "none",
  cursor: "pointer",
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: "bold",
  background: "#8b5cf6",
  borderRadius: 6,
  whiteSpace: "nowrap",
};
