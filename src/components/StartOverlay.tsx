export function StartOverlay({ onStart }: { onStart: () => void }) {
  return (
    <div className="start-overlay">
      <button
        type="button"
        className="start-button"
        onClick={onStart}
        aria-label="会話をはじめる"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="9"
            y="3.5"
            width="6"
            height="10.5"
            rx="3"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        はじめる
      </button>
      <p className="start-hint">レムに話しかけてね</p>
    </div>
  );
}
