import { useCallback, useState } from "react";
import { useGeminiLive, type GeminiState } from "../hooks/useGeminiLive";
import "./talk.css";

const TALK_PROMPT =
  "あなたは MIRAGE の対話パートナーです。日本語で、短く自然に話します。" +
  "一文は40文字以内。相手の話をよく聞き、相づちを打ち、必要なら質問を返します。" +
  "落ち着いた、少し神秘的な口調。説教くさくならない。" +
  "天気・検索・施設案内は今は使いません。";

function stateClass(state: GeminiState): string {
  if (state === "speaking") return "is-speaking";
  if (state === "listening") return "is-listening";
  if (state === "connecting") return "is-connecting";
  if (state === "error") return "is-error";
  return "is-idle";
}

export function TalkStage() {
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gemini = useGeminiLive({
    capture: true,
    systemPrompt: TALK_PROMPT,
    onError: (e) => setError(e.message),
  });

  const connected = gemini.state === "listening" || gemini.state === "speaking";
  const connecting = gemini.state === "connecting";
  const level = Math.max(gemini.micLevel, gemini.outLevel);

  const start = useCallback(async () => {
    setError(null);
    try {
      await gemini.connect();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [gemini.connect]);

  const disconnect = useCallback(() => {
    setError(null);
    gemini.disconnect();
  }, [gemini.disconnect]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    gemini.setMuted(next);
  }, [muted, gemini.setMuted]);

  return (
    <div className="talk">
      <header className="talk-top">
        <div className="talk-brand">
          <span className="talk-brand-mark">MIRAGE</span>
          <span className="talk-brand-sub">CONVERSATION</span>
        </div>
        <a className="talk-link" href="/dance.html">
          DANCE STAGE
        </a>
      </header>

      <main className="talk-main">
        <div
          className={`talk-orb ${stateClass(gemini.state)}`}
          style={{ transform: `scale(${1 + level * 0.18})` }}
          aria-hidden="true"
        />
        {!connected && !connecting && (
          <p className="talk-hint">{error ? "TAP TO RETRY" : "TAP TO TALK"}</p>
        )}
      </main>

      <footer className="talk-controls">
        {connected ? (
          <>
            <button className="talk-button" onClick={toggleMute} aria-label={muted ? "音を出す" : "音を消す"}>
              {muted ? "SOUND OFF" : "SOUND ON"}
            </button>
            <button className="talk-button talk-primary" onClick={disconnect}>
              END
            </button>
          </>
        ) : (
          <button className="talk-button talk-primary" onClick={start} disabled={connecting}>
            {connecting ? "CONNECTING…" : "START"}
          </button>
        )}
      </footer>

      {error && connected && <p className="talk-error">{error}</p>}
      <p className="sr-only" aria-live="polite">
        {gemini.state}
      </p>
    </div>
  );
}
