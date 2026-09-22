import { useCallback, useRef, useState } from "react";
import {
  SPEECH_THRESHOLD,
  SILENCE_DURATION_MS,
  MIN_SPEECH_MS,
  transcribeBlob,
} from "./conversation/stt";
import {
  SYSTEM_PROMPT,
  NUDGE_LINES,
  ACTION_TAG_RE,
  ACTION_TAG_GIVEUP_CHARS,
  ACTION_TAG_GLOBAL_RE,
  extractReadySentence,
  stripInlineActionTags,
  streamGroqChat,
  fetchOllamaChat,
} from "./conversation/llm";
import type { ActionTag, ChatMessage } from "./conversation/llm";
import { DEFAULT_SPEAKER_ID, synthesizeAivis } from "./conversation/tts";

// re-export（Avatar / App / Playground 向けの公開型）
export type { ActionTag } from "./conversation/llm";
export type ConvState = "idle" | "listening" | "thinking" | "speaking";
export type LogEntry = { id: number; role: "user" | "assistant"; text: string };

// 会話中この時間沈黙が続いたらレムから話題を振る。
// 会話開始の一言のすぐ後(10秒)にナッジが重なって一方的にならないよう20秒に広げた
const IDLE_NUDGE_MS = 20000;

export function useConversation(
  speakingRef: React.MutableRefObject<boolean>,
  volumeRef: React.MutableRefObject<number>,
  panRef?: React.MutableRefObject<number>, // 空間オーディオ用: -1(左)〜1(右)。省略時はセンター固定
  // 会話の各ターン直前に呼ばれ、いまの知覚を短い文で返す（systemメモ差し込み用・履歴には積まない）
  getContext?: () => string,
  // 人格プロンプトの上書き。省略時は既定のレム人格
  systemPrompt?: string,
  // 沈黙促しセリフの上書き。空配列で無効化
  nudgeLines?: string[],
  // AivisSpeechの話者ID上書き
  speakerId?: number,
) {
  // getContext/App側の毎レンダー新関数をrefに退避して依存から外す
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;
  const systemPromptRef = useRef(systemPrompt ?? SYSTEM_PROMPT);
  systemPromptRef.current = systemPrompt ?? SYSTEM_PROMPT;
  const nudgeLinesRef = useRef(nudgeLines ?? NUDGE_LINES);
  nudgeLinesRef.current = nudgeLines ?? NUDGE_LINES;
  const speakerIdRef = useRef(speakerId ?? DEFAULT_SPEAKER_ID);
  speakerIdRef.current = speakerId ?? DEFAULT_SPEAKER_ID;

  const [state, setState] = useState<ConvState>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);

  const historyRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logIdRef = useRef(0);

  // VAD用
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const vadRafRef = useRef<number>(0);
  const lastSpeechRef = useRef<number>(0);
  const speechStartRef = useRef<number>(0);
  const isSpeechRef = useRef(false);
  const activeRef = useRef(false); // 会話モードがONか
  const busyRef = useRef(false); // LLM/TTS処理中か（沈黙ナッジの誤発火防止）
  const lastInteractionRef = useRef(0); // 最後にやり取りがあった時刻（沈黙検知用）
  const activeSourceRef = useRef<{ stop: () => void; ctx: AudioContext } | null>(null);
  const ttsQueueRef = useRef<Promise<void>>(Promise.resolve()); // 文単位のTTSを順番に直列再生するキュー
  // 発話の「世代」カウンタ。stopConversationのたびに増分し、通信中の古いTTSの再生を諦める
  const speechEpochRef = useRef(0);

  // 再生中の音声を止める（次の発話開始時、会話終了時で使う共通処理）
  const interruptSpeech = useCallback(() => {
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch { /* already stopped */ }
      activeSourceRef.current.ctx.close().catch(() => {});
      activeSourceRef.current = null;
    }
    speechSynthesis.cancel();
    speakingRef.current = false;
    volumeRef.current = 0;
  }, [speakingRef, volumeRef]);

  // 行動タグ: idはトリガーの度に増分し、Avatar側は「値が変わったら新規トリガー」として検知する
  const actionRef = useRef<{ tag: ActionTag; id: number } | null>(null);
  const actionIdRef = useRef(0);
  const fire = (tag: ActionTag) => {
    actionRef.current = { tag, id: ++actionIdRef.current };
  };
  // 相手が話している間の相槌(頷き)の最終発火時刻（連発防止）
  const lastListenNodRef = useRef(0);

  // ---- TTS（合成は tts.ts、再生はここで） ----
  const speakAivis = useCallback(async (text: string) => {
    // 前の音声がまだ再生中なら止めてから新しい発話を始める（声の重なり防止）
    interruptSpeech();
    const epoch = speechEpochRef.current;
    try {
      const buf = await synthesizeAivis(text, speakerIdRef.current);
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const panner = ctx.createStereoPanner();
      const source = ctx.createBufferSource();
      source.buffer = await ctx.decodeAudioData(buf);
      if (epoch !== speechEpochRef.current) {
        // 通信待ちの間に会話が終了/リセットされていた → 裏で勝手に喋らせない
        ctx.close().catch(() => {});
        return;
      }
      source.connect(panner);
      panner.connect(analyser);
      analyser.connect(ctx.destination);
      speakingRef.current = true;
      setState("speaking");
      activeSourceRef.current = { stop: () => source.stop(), ctx };
      function tick() {
        if (!speakingRef.current) return;
        analyser.getByteFrequencyData(data);
        volumeRef.current = Math.min(data.reduce((a, b) => a + b, 0) / data.length / 60, 1);
        // 来場者が左右どちらにいるかで声のパンを追従させる（喋ってる間も動きに追従）
        panner.pan.value = Math.max(-1, Math.min(1, panRef?.current ?? 0));
        requestAnimationFrame(tick);
      }
      await new Promise<void>((resolve) => {
        source.onended = () => {
          speakingRef.current = false;
          volumeRef.current = 0;
          if (activeSourceRef.current?.ctx === ctx) activeSourceRef.current = null;
          if (ctx.state !== "closed") ctx.close().catch(() => {});
          resolve();
        };
        source.start();
        tick();
      });
    } catch {
      if (epoch !== speechEpochRef.current) return;
      // Aivis不可 → Web Speech API フォールバック
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "ja-JP"; u.rate = 1.05; u.pitch = 1.2;
        const jp = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja"));
        if (jp) u.voice = jp;
        u.onstart = () => { speakingRef.current = true; volumeRef.current = 0.6; setState("speaking"); };
        u.onend = () => { speakingRef.current = false; volumeRef.current = 0; resolve(); };
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      });
    }
  }, [speakingRef, volumeRef, panRef, interruptSpeech]);

  // 単単発発話の単一経路（announce/nudge共用）: 履歴+表示+ログ確定までを一括で行う
  const commitAssistant = (text: string) => {
    historyRef.current.push({ role: "assistant", content: text });
    setReply(text);
    setLog((prev) => [...prev, { id: logIdRef.current++, role: "assistant", text }]);
  };
  const speakSingle = async (text: string) => {
    commitAssistant(text);
    await speakAivis(text);
  };

  // ---- LLM（ストリーミング。Groq → Ollamaフォールバックは llm.ts） ----
  // トークンを逐次受信し、文（。！？）が完成するたびに生成完了を待たずTTSへ回す
  const chat = useCallback(async (userText: string) => {
    busyRef.current = true;
    setState("thinking");
    historyRef.current.push({ role: "user", content: userText });

    // いまの知覚を直近のuser発話の直前にsystemメモとして差し込む（履歴には積まない）
    const contextNote = getContextRef.current?.().trim();
    const messages: ChatMessage[] = [
      { role: "system", content: systemPromptRef.current },
      ...historyRef.current,
    ];
    if (contextNote) {
      messages.splice(messages.length - 1, 0, { role: "system", content: `【いまの状況】${contextNote}` });
    }

    // ストリーミング中の空バブルを作って中身を随時更新する
    const entryId = logIdRef.current++;
    setLog((prev) => [...prev, { id: entryId, role: "assistant", text: "" }]);
    let full = "";
    let unspoken = "";
    let tagChecked = false; // 応答冒頭の行動タグ判定が済んだか
    ttsQueueRef.current = Promise.resolve();

    const flushLog = (text: string) => {
      setLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, text } : e)));
      setReply(text);
    };

    try {
      abortRef.current = new AbortController();
      await streamGroqChat(messages, abortRef.current.signal, (piece) => {
        full += piece;
        unspoken += piece;

        // 応答冒頭の行動タグを検出・除去。文分割より前、full/unspokenが同一内容のうちに処理
        if (!tagChecked) {
          if (unspoken.length > 0 && unspoken[0] !== "[") {
            tagChecked = true;
          } else {
            const m = ACTION_TAG_RE.exec(unspoken);
            if (m) {
              unspoken = unspoken.slice(m[0].length);
              full = full.slice(m[0].length);
              tagChecked = true;
              fire(m[1] as ActionTag);
            } else if (unspoken.length >= ACTION_TAG_GIVEUP_CHARS) {
              tagChecked = true; // タグの形になっていない → タグなしと判断
            }
          }
        }

        flushLog(full);

        if (tagChecked) {
          const ready = extractReadySentence(unspoken);
          if (ready) {
            unspoken = ready.rest;
            let sentence = ready.sentence;
            if (ACTION_TAG_GLOBAL_RE.test(sentence)) {
              const { cleaned, tags } = stripInlineActionTags(sentence);
              for (const tag of tags) fire(tag);
              full = full.replace(sentence, cleaned);
              sentence = cleaned;
              flushLog(full);
            }
            if (sentence) {
              setState("speaking");
              const line = sentence;
              ttsQueueRef.current = ttsQueueRef.current.then(() => speakAivis(line));
            }
          }
        }
      });
    } catch (err) {
      // ユーザーが会話を終了した（abort）だけならフォールバックしない。Groq障害/ネット切断時のみローカルへ
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        try {
          abortRef.current = new AbortController();
          const ollamaText = await fetchOllamaChat(messages, abortRef.current.signal);
          if (ollamaText) {
            // Ollamaは非ストリーミング。Groq途中経過は捨てて全文で置き換える（従来仕様）
            full = ollamaText;
            unspoken = ollamaText;
            flushLog(full);
          }
        } catch { /* ローカルも失敗。諦める */ }
      }
    }

    let rest = unspoken.trim();
    if (rest && ACTION_TAG_GLOBAL_RE.test(rest)) {
      const { cleaned, tags } = stripInlineActionTags(rest);
      for (const tag of tags) fire(tag);
      full = full.replace(rest, cleaned);
      rest = cleaned;
      flushLog(full);
    }
    if (rest && activeRef.current) {
      setState("speaking");
      const line = rest;
      ttsQueueRef.current = ttsQueueRef.current.then(() => speakAivis(line));
    }
    if (full) historyRef.current.push({ role: "assistant", content: full });

    await ttsQueueRef.current; // 全文の読み上げが終わるまで待つ
    if (activeRef.current) setState("listening");
    else setState("idle");
    busyRef.current = false;
    lastInteractionRef.current = Date.now();
  }, [speakAivis]);

  // 固定文を1つ読み上げるだけの発話（LLMを呼ばない）
  const announce = useCallback(async (text: string) => {
    await speakSingle(text);
  }, [speakAivis]);

  // 沈黙が続いたときレム側から話題を振る（LLMは呼ばない）
  const nudge = useCallback(async () => {
    if (!activeRef.current || busyRef.current) return;
    const pool = nudgeLinesRef.current;
    if (pool.length === 0) return; // 空配列＝沈黙促し発話を無効化
    busyRef.current = true;
    setState("thinking");
    const line = pool[Math.floor(Math.random() * pool.length)];
    await speakSingle(line);
    if (activeRef.current) setState("listening");
    else setState("idle");
    busyRef.current = false;
    lastInteractionRef.current = Date.now();
  }, [speakAivis]);

  // ---- VAD ループ ----
  const startVadLoop = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);

    function loop() {
      if (!activeRef.current) return;

      // レムが喋ってる/考え中の間はVADを止める（二重録音・ログ重複防止）
      if (speakingRef.current || busyRef.current) {
        vadRafRef.current = requestAnimationFrame(loop);
        return;
      }

      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const now = Date.now();

      if (avg > SPEECH_THRESHOLD) {
        // 音声検知
        lastSpeechRef.current = now;
        lastInteractionRef.current = now;
        if (!isSpeechRef.current) {
          isSpeechRef.current = true;
          speechStartRef.current = now;
          // 録音開始
          chunksRef.current = [];
          recorderRef.current?.start();
          // 相手が話し始めたら「うんうん」と頷いて聞く（相槌）
          fire("nod");
          lastListenNodRef.current = now;
        } else if (now - lastListenNodRef.current > 2600 && Math.random() < 0.6) {
          // 長めに話している時はたまに追加で頷く（機械的な連発は避ける）
          fire("nod");
          lastListenNodRef.current = now;
        }
      } else if (isSpeechRef.current && now - lastSpeechRef.current > SILENCE_DURATION_MS) {
        // 無音検知 → 録音停止 → STTへ
        isSpeechRef.current = false;
        const speechDuration = lastSpeechRef.current - speechStartRef.current;
        recorderRef.current?.stop();
        if (speechDuration < MIN_SPEECH_MS) {
          // 短すぎる発話は無視、すぐ再録音できる状態に戻す
          chunksRef.current = [];
        }
      } else if (
        !isSpeechRef.current &&
        !busyRef.current &&
        now - lastInteractionRef.current > IDLE_NUDGE_MS
      ) {
        // 沈黙が続いた → レムから話題を振る
        lastInteractionRef.current = now; // 連続発火防止
        nudge();
      }

      vadRafRef.current = requestAnimationFrame(loop);
    }
    loop();
  }, [speakingRef, nudge]);

  // ---- 会話モードON ----
  const startConversation = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    lastInteractionRef.current = Date.now();
    setState("listening");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      if (!activeRef.current || chunksRef.current.length === 0) return;
      // STT問い合わせ中もVADを止める（二重録音防止）
      busyRef.current = true;
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = [];
      try {
        setState("thinking");
        const text = await transcribeBlob(blob);
        if (text && activeRef.current) {
          setTranscript(text);
          setLog((prev) => [...prev, { id: logIdRef.current++, role: "user", text }]);
          await chat(text);
          return;
        }
      } catch { /* STT失敗（ローカルも含め両方ダメだった） */ }
      busyRef.current = false;
      if (activeRef.current) setState("listening");
    };

    startVadLoop(analyser);
  }, [chat, startVadLoop]);

  // ---- 会話モードOFF ----
  const stopConversation = useCallback(() => {
    activeRef.current = false;
    cancelAnimationFrame(vadRafRef.current);
    abortRef.current?.abort();
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    interruptSpeech();
    speechEpochRef.current++; // 通信待ち中の古いTTSが後から再生されるのを防ぐ
    ttsQueueRef.current = Promise.resolve(); // 溜まっていた再生キューも破棄
    isSpeechRef.current = false;
    busyRef.current = false;
    setState("idle");
  }, [interruptSpeech]);

  const resetHistory = useCallback(() => {
    historyRef.current = [];
    setTranscript("");
    setReply("");
    setLog([]);
  }, []);

  return { state, transcript, reply, log, startConversation, stopConversation, resetHistory, actionRef, announce };
}
