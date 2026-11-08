import type { CSSProperties } from "react";

export function FallbackBanner({ notice, onRetry }: { notice: string; onRetry: () => void }) {
  return (
    <div style={fallbackBannerStyle}>
      <span>{notice}</span>
      <button style={fallbackBackBtnStyle} onClick={onRetry}>
        Geminiへ復帰
      </button>
    </div>
  );
}

const fallbackBannerStyle: CSSProperties = {
  position: "absolute",
  top: 20,
  right: 20,
  maxWidth: "min(380px, 80vw)",
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 16px",
  background: "#F8E9E2",
  border: "1px solid #EDD2C6",
  borderRadius: 16,
  fontSize: 13,
  lineHeight: 1.6,
  color: "#6F4A3B",
  boxShadow: "0 6px 20px rgba(120, 90, 75, 0.08)",
  zIndex: 25,
};

const fallbackBackBtnStyle: CSSProperties = {
  color: "#4A3228",
  border: "none",
  cursor: "pointer",
  padding: "8px 14px",
  fontSize: 12,
  fontWeight: 600,
  background: "#E7C3B3",
  borderRadius: 999,
  whiteSpace: "nowrap",
};
