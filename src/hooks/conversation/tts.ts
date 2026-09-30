// ローカルTTSはWeb Speech API で読み上げる
import type { RefObject } from "react";

export function speakWithWebSpeech(text: string): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 1.05;
    u.pitch = 1.2;
    const jp = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja"));
    if (jp) u.voice = jp;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

// ローカル会話用: Web Speechで喋り、終わるまで待つ。リップシンク用refも駆動する
export function speakAndWait(
  text: string,
  speakingRef: RefObject<boolean>,
  volumeRef: RefObject<number>,
  maxMs = 15000,
): Promise<void> {
  speakingRef.current = true;
  volumeRef.current = 0.6;
  const timeout = new Promise<void>((r) => setTimeout(r, maxMs));
  return Promise.race([speakWithWebSpeech(text), timeout]).finally(() => {
    speakingRef.current = false;
    volumeRef.current = 0;
  });
}

// speakingRef.current が false になる（今の発話が終わる）まで待つ。
// fire-and-forgetなspeak()の再生完了待ち用。maxMsは万一終わらない場合の保険の上限
export function waitUntilNotSpeaking(
  speakingRef: RefObject<boolean>,
  maxMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    function poll() {
      if (!speakingRef.current || performance.now() - start > maxMs) {
        resolve();
        return;
      }
      setTimeout(poll, 150);
    }
    poll();
  });
}
