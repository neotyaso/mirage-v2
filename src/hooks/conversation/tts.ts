// ローカルTTSはWeb Speech API で読み上げる
import { useEffect } from "react";
import type { RefObject } from "react";

// 音声リストの事前読み込み。初回発話で日本語ボイスが選ばれるようにする。
export function useVoiceWarmup(): void {
  useEffect(() => {
    const sync = () => speechSynthesis.getVoices();
    sync();
    speechSynthesis.onvoiceschanged = sync;
    return () => { speechSynthesis.onvoiceschanged = null; };
  }, []);
}

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

// 再生中の音声を止め、リップシンク用refを倒す
export function stopAppAudio(
  speakingRef: RefObject<boolean>,
  volumeRef: RefObject<number>,
): void {
  speechSynthesis.cancel();
  speakingRef.current = false;
  volumeRef.current = 0;
}

// 発話はWeb Speech。呼び込み・開始/別れの一言用（fire-and-forget）。
// 会話本体の声はGemini Live。前の発話が残っていたら止めてから喋る。
export function speak(
  text: string,
  speakingRef: RefObject<boolean>,
  volumeRef: RefObject<number>,
): void {
  stopAppAudio(speakingRef, volumeRef);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP"; u.rate = 1.05; u.pitch = 1.2;
  const jp = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja"));
  if (jp) u.voice = jp;
  u.onstart = () => { speakingRef.current = true; volumeRef.current = 0.6; };
  u.onend = () => { speakingRef.current = false; volumeRef.current = 0; };
  u.onerror = () => { speakingRef.current = false; volumeRef.current = 0; };
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
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
