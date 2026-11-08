import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import type { FunctionCall, FunctionDeclaration, LiveServerMessage } from "@google/genai";
import { fetchPage, webSearch } from "../web/search";
import { getWeather } from "../web/weather";
import { facilityPrompt } from "../data/facility";

// Gemini Live API 直結フック (AI Studio と同じ公式SDK方式)。
// 自前WS実装は捨てた。メッセージ形式・再接続はSDK任せ。
// 認証は Studio が発行する短命トークン（D-018）。APIキーはブラウザに置かない。
// 音声: 送信 16kHz PCM16 / 受信 24kHz PCM16。

export type GeminiState = "disconnected" | "connecting" | "listening" | "speaking" | "error";

export type GeminiLogRole = "user" | "assistant";

export interface GeminiLogEntry {
  id: number;
  role: GeminiLogRole;
  text: string;
}

export interface GeminiMetrics {
  connectMs: number | null;
  firstAudioMs: number | null;
  turns: number;
  disconnects: number;
  toolRuns: number;
  lastTool: { name: string; query: string; ms: number; ok: boolean } | null;
}

const IN_RATE = 16_000;
const OUT_RATE = 24_000;
const MODEL = "gemini-3.8-live";
// 声は Zephyr 固定 (Lab側の選択肢は撤去済み)
const VOICE = "Zephyr";

// 検索は模型に任せる。コード側でキーワード判定はしない（言い方が無限にあるため）
const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_weather",
    description:
      "Get today's and tomorrow's weather for the venue (temperature, condition, rain chance). " +
      "Use this for any weather question instead of web_search. Fast and always current.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "web_search",
    description:
      "Search the web for current information such as weather, opening hours, events or news. " +
      "Returns titles, URLs and short snippets. Snippets often lack specific numbers, so call fetch_page when needed. Say a short filler like 調べますね before calling.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "検索語。来場者の言語に合わせる" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_page",
    description:
      "Read a web page as Markdown. Use only when web_search snippets are not enough to answer. Takes 1-3 seconds.",
    parameters: {
      type: Type.OBJECT,
      properties: { url: { type: Type.STRING, description: "web_search が返した URL" } },
      required: ["url"],
    },
  },
];

const SYSTEM_PROMPT =
  "あなたは展示ブースの明るい受付嬢レムです。日本語で、短く元気に話します。" +
  "一文は40文字以内。相手の話に具体的に反応し、質問で会話を続けます。" +
  "天気を聞かれたら get_weather を使います（web_search は使わない）。" +
  "施設の営業時間・場所・料金は【施設情報】に書いてあることだけを答えます。" +
  "イベント・ニュース・店など、自分が知らない最新情報を聞かれたら web_search を使います。" +
  "呼ぶ前に「ちょっと調べますね」と一言言ってください。" +
  "web_search の抜粋に気温・降水確率・営業時間などの具体的な値が無いときは、必ず fetch_page で1ページ読んでから答えます。" +
  "同じ検索を言い換えて2回やらない。検索は1回、本文は最大2ページまで。" +
  "答えるときは出典のサイト名を添えます。調べられなかったときは推測せず「今は調べられない」と言います。" +
  "雑談や一般常識では検索しません。";
// shortcut: ツール実行中のフィラーはモデル任せ（言わないことがある）。実機で無音が目立つならローカルTTSを足す

function systemPromptWith(context?: string): string {
  const base = `${SYSTEM_PROMPT}\n${facilityPrompt()}`;
  if (!context) return base;
  return `${base}\n[来場者状況: ${context}] この様子を踏まえて第一声を調整して。`;
}

interface UseGeminiLiveOptions {
  onStateChange?: (s: GeminiState) => void;
  onError?: (e: Error) => void;
  onInputText?: (t: string) => void;
  onOutputText?: (t: string) => void;
  /** 受付用の既定プロンプトを差し替える（DJなど） */
  systemPrompt?: string;
  /** 既定の受付ツールを差し替える */
  tools?: FunctionDeclaration[];
  /** ツール実行を差し替える。未指定なら受付用の天気・検索 */
  onToolCall?: (call: FunctionCall) => Promise<Record<string, unknown>>;
  /** false にするとマイクを開かない（MCの音声出力専用） */
  capture?: boolean;
}

function b64encodeBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

type LiveSession = Awaited<ReturnType<GoogleGenAI["live"]["connect"]>>;

export function useGeminiLive(options: UseGeminiLiveOptions = {}) {
  const { onStateChange, onError, onInputText, onOutputText } = options;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onInputTextRef = useRef(onInputText);
  onInputTextRef.current = onInputText;
  const onOutputTextRef = useRef(onOutputText);
  onOutputTextRef.current = onOutputText;
  const systemPromptRef = useRef(options.systemPrompt);
  systemPromptRef.current = options.systemPrompt;
  const toolsRef = useRef(options.tools);
  toolsRef.current = options.tools;
  const customToolRef = useRef(options.onToolCall);
  customToolRef.current = options.onToolCall;
  const captureRef = useRef(options.capture ?? true);
  captureRef.current = options.capture ?? true;

  const sessionRef = useRef<LiveSession | null>(null);
  const capCtxRef = useRef<AudioContext | null>(null);
  const capNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playGainRef = useRef<GainNode | null>(null);
  const mutedRef = useRef(false);
  // 再生追跡は単一refに集約 (playing=再生中 / cursor=次chunk予約時刻 / gen=世代 / current=直近source / active=予約済みsource群)
  const playRef = useRef<{
    playing: boolean;
    cursor: number;
    gen: number;
    current: AudioBufferSourceNode | null;
    active: Set<AudioBufferSourceNode>;
  }>({ playing: false, cursor: 0, gen: 0, current: null, active: new Set() });
  const stateRef = useRef<GeminiState>("disconnected");
  const attemptRef = useRef(0);

  const [state, setState] = useState<GeminiState>("disconnected");
  const [micLevel, setMicLevel] = useState(0);
  const [outLevel, setOutLevel] = useState(0);
  const [via, setVia] = useState("");
  const [log, setLog] = useState<GeminiLogEntry[]>([]);
  const [metrics, setMetrics] = useState<GeminiMetrics>({
    connectMs: null,
    firstAudioMs: null,
    turns: 0,
    disconnects: 0,
    toolRuns: 0,
    lastTool: null,
  });
  const logIdRef = useRef(0);
  const connectStartRef = useRef<number | null>(null);
  const firstAudioDoneRef = useRef(false);

  const setStateSafe = useCallback(
    (s: GeminiState) => {
      stateRef.current = s;
      setState(s);
      onStateChange?.(s);
    },
    [onStateChange]
  );

  const resetTranscript = useCallback(() => {
    logIdRef.current = 0;
    setLog([]);
  }, []);

  const appendLog = useCallback((role: GeminiLogRole, text: string) => {
    const id = logIdRef.current++;
    setLog((prev) => [...prev, { id, role, text }]);
  }, []);

  const stopPlayback = useCallback(() => {
    const p = playRef.current;
    for (const src of p.active) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
    }
    p.active.clear();
    p.current = null;
    p.cursor = 0;
    p.playing = false;
  }, []);

  const playPcm24k = useCallback(
    async (pcm: Float32Array) => {
      if (connectStartRef.current !== null && !firstAudioDoneRef.current) {
        firstAudioDoneRef.current = true;
        const ms = performance.now() - connectStartRef.current;
        setMetrics((m) => (m.firstAudioMs === null ? { ...m, firstAudioMs: ms } : m));
      }
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
      setOutLevel(Math.min(1, Math.sqrt(sum / pcm.length) * 3));

      if (!playCtxRef.current) {
        playCtxRef.current = new AudioContext({ sampleRate: OUT_RATE });
      }
      const ctx = playCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();
      if (!playGainRef.current) {
        playGainRef.current = ctx.createGain();
        playGainRef.current.gain.value = mutedRef.current ? 0 : 1;
        playGainRef.current.connect(ctx.destination);
      }
      setStateSafe("speaking");

      // ギャップレス再生: onended連鎖だとJSスレッドの隙間でブツ切れになるため、
      // AudioContext時刻基準で次チャンクを予約していく
      const buf = ctx.createBuffer(1, pcm.length, OUT_RATE);
      buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(playGainRef.current);
      const p = playRef.current;
      p.active.add(src);
      const now = ctx.currentTime;
      if (p.cursor < now - 0.2) p.cursor = now + 0.05;
      const startAt = p.cursor;
      p.cursor = startAt + buf.duration;
      p.gen += 1;
      const myGen = p.gen;
      p.current = src;
      p.playing = true;
      src.onended = () => {
        p.active.delete(src);
        if (p.current === src) p.current = null;
        // 猶予内に新チャンクが来なければ発話終了とみなす
        setTimeout(() => {
          if (p.gen === myGen && stateRef.current === "speaking") {
            p.playing = false;
            setStateSafe("listening");
          }
        }, 350);
      };
      try {
        src.start(startAt);
      } catch {
        p.active.delete(src);
      }
    },
    [setStateSafe]
  );

  // モデルが選んだツールを実行して結果を返す。失敗は error で返し、推測で答えさせない。
  const handleToolCalls = useCallback(async (calls: FunctionCall[]) => {
    const responses = await Promise.all(
      calls.map(async (call) => {
        const started = performance.now();
        const name = call.name ?? "";
        const custom = customToolRef.current;
        const query = custom
          ? JSON.stringify(call.args ?? {})
          : name === "get_weather"
            ? "天気"
            : name === "web_search"
              ? String(call.args?.query ?? "")
              : String(call.args?.url ?? "");
        // DJ など用途別のツール実行。渡されていれば受付用の分岐は使わない。
        if (custom) {
          let response: Record<string, unknown>;
          let ok = true;
          try {
            response = await custom(call);
          } catch (e) {
            ok = false;
            response = { error: "unavailable" };
            console.error(`[Gemini] tool ${name} failed:`, e);
          }
          const ms = performance.now() - started;
          setMetrics((m) => ({ ...m, toolRuns: m.toolRuns + 1, lastTool: { name, query, ms, ok } }));
          return { id: call.id, name, response };
        }
        let ok = true;
        let response: Record<string, unknown>;
        try {
          if (name === "get_weather") {
            const report = await getWeather();
            response = { output: report.text };
            console.info(`[Gemini] get_weather ${report.place}`);
          } else if (name === "web_search") {
            // 生のJSON配列より、モデルが読みやすいテキストにして返す。
            // NOTE行が無いと「抜粋に答えが無い → 調べられない」で止まる（実機で発生）
            const results = await webSearch(query);
            if (results.length === 0) {
              ok = false;
              response = { error: "no results" };
              return { id: call.id, name, response };
            }
            const text = results
              .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
              .join("\n\n");
            response = {
              output:
                text +
                "\n\nNOTE: 気温・降水確率・営業時間・料金などの具体的な値が上の抜粋に無いときは、" +
                "この中のURLを fetch_page で読んでから答える。同じ検索を言い換えて繰り返さない。",
            };
            console.info(`[Gemini] web_search "${query}" → ${results.length}件`);
          } else if (name === "fetch_page") {
            const markdown = await fetchPage(query);
            response = { output: markdown };
            console.info(`[Gemini] fetch_page ${query} → ${markdown.length}文字`);
          } else {
            ok = false;
            response = { error: `unknown tool: ${name}` };
          }
        } catch (e) {
          ok = false;
          response = { error: "unavailable" };
          console.error(`[Gemini] tool ${name} failed:`, e);
        }
        const ms = performance.now() - started;
        setMetrics((m) => ({ ...m, toolRuns: m.toolRuns + 1, lastTool: { name, query, ms, ok } }));
        return { id: call.id, name, response };
      })
    );
    try {
      sessionRef.current?.sendToolResponse({ functionResponses: responses });
    } catch (e) {
      console.error("[Gemini] sendToolResponse failed:", e);
    }
  }, []);

  const handleServerMessage = useCallback(
    async (msg: LiveServerMessage) => {
      // toolCall は serverContent を伴わないので先に処理する
      if (msg.toolCall?.functionCalls?.length) {
        for (const call of msg.toolCall.functionCalls) {
          console.info("[Gemini] toolCall", call.name, call.args);
        }
        void handleToolCalls(msg.toolCall.functionCalls);
      }
      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.turnComplete) {
        setMetrics((m) => ({ ...m, turns: m.turns + 1 }));
        if (stateRef.current !== "disconnected") setStateSafe("listening");
        return;
      }
      if (sc.interrupted) {
        stopPlayback();
        setStateSafe("listening");
        return;
      }
      for (const part of sc.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (data) {
          try {
            const bin = atob(data);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const int16 = new Int16Array(buf);
            const f = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) f[i] = int16[i] / 32768;
            await playPcm24k(f);
          } catch (e) {
            console.error("[Gemini] audio decode failed:", e);
          }
        }
      }
      const outT = sc.outputTranscription?.text;
      if (outT) {
        appendLog("assistant", outT);
        onOutputTextRef.current?.(outT);
      }
      const inT = sc.inputTranscription?.text;
      if (inT) {
        appendLog("user", inT);
        onInputTextRef.current?.(inT);
      }
    },
    [playPcm24k, stopPlayback, setStateSafe, appendLog, handleToolCalls]
  );

  const startCapture = useCallback(async () => {
    if (capCtxRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: IN_RATE, echoCancellation: true, noiseSuppression: true },
    });
    streamRef.current = stream;
    const ctx = new AudioContext({ sampleRate: IN_RATE });
    capCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const code = `class Cap extends AudioWorkletProcessor {
      constructor(){ super(); this.buf=[]; }
      process(inputs){
        const ch = inputs[0]?.[0];
        if (ch) {
          let sum=0;
          for (let i=0;i<ch.length;i++){ this.buf.push(ch[i]); sum+=ch[i]*ch[i]; }
          this.port.postMessage({type:"lvl", v:Math.sqrt(sum/ch.length)});
          while (this.buf.length >= 2048) {
            const out = this.buf.slice(0,2048); this.buf = this.buf.slice(2048);
            this.port.postMessage({type:"frame", pcm:out});
          }
        }
        return true;
      }
    }
    registerProcessor("gemini-cap", Cap);`;
    const blobUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
    if (capCtxRef.current !== ctx) {
      void ctx.close().catch(() => {});
      return;
    }
    const node = new AudioWorkletNode(ctx, "gemini-cap");
    capNodeRef.current = node;
    // レベル表示は約10Hzに間引く (125Hz再レンダーは固まる元)
    let lvlCount = 0;
    let lastLvl = 0;
    node.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "lvl") {
        const v = Math.min(1, Number(e.data.v) * 3);
        lvlCount++;
        if (lvlCount % 12 === 0 || Math.abs(v - lastLvl) > 0.25) {
          lastLvl = v;
          setMicLevel(v);
        }
      } else if (e.data?.type === "frame" && sessionRef.current) {
        const arr = Float32Array.from(e.data.pcm as number[]);
        const int16 = new Int16Array(arr.length);
        for (let i = 0; i < arr.length; i++) {
          int16[i] = Math.round(Math.max(-1, Math.min(1, arr[i])) * 32767);
        }
        try {
          void sessionRef.current.sendRealtimeInput({
            audio: { data: b64encodeBytes(new Uint8Array(int16.buffer)), mimeType: "audio/pcm;rate=16000" },
          });
        } catch (err) {
          console.error("[Gemini] send failed:", err);
        }
      }
    };
    src.connect(node);
    // NOTE: node.connect(ctx.destination) はしない (ハウリング防止)
  }, []);

  const stopCapture = useCallback(() => {
    capNodeRef.current?.disconnect();
    capNodeRef.current = null;
    void capCtxRef.current?.close().catch(() => {});
    capCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const connect = useCallback(
    async (context?: string) => {
    try {
      sessionRef.current?.close();
    } catch {
      /* ignore */
    }
    sessionRef.current = null;
    if (!playCtxRef.current) playCtxRef.current = new AudioContext({ sampleRate: OUT_RATE });
    if (playCtxRef.current.state === "suspended") await playCtxRef.current.resume();

    const myAttempt = ++attemptRef.current;
    connectStartRef.current = performance.now();
    firstAudioDoneRef.current = false;
    setMetrics((m) => ({ ...m, connectMs: null, firstAudioMs: null }));
    setStateSafe("connecting");
    setVia("トークン取得中…");
    // キーではなく Studio 発行の短命トークンで接続する（D-018）
    let apiKey: string;
    try {
      const res = await fetch("/studio/api/live/token", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { token?: string };
      if (!data.token) throw new Error("token なし");
      apiKey = data.token;
    } catch (e) {
      setVia("");
      setStateSafe("error");
      throw new Error(
        `短命トークンを取得できません（Studio 未起動 / GEMINI_API_KEY 未設定？）: ${(e as Error).message}`,
      );
    }
    setVia("SDK直結（短命トークン）");
    // 短命トークンの Live 接続は SDK 上 v1alpha のみ（SDK 自身の警告に従う）
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
    const handleMessage = handleServerMessage;
    const customPrompt = systemPromptRef.current;
    const systemInstruction = customPrompt
      ? context
        ? `${customPrompt}\n[状況: ${context}]`
        : customPrompt
      : systemPromptWith(context);
    const session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: toolsRef.current ?? TOOL_DECLARATIONS }],
      },
      callbacks: {
        onopen: () => {
          if (attemptRef.current !== myAttempt) return;
          if (connectStartRef.current !== null) {
            const ms = performance.now() - connectStartRef.current;
            setMetrics((m) => ({ ...m, connectMs: ms }));
          }
          if (captureRef.current) {
            void startCapture().catch((e) => onErrorRef.current?.(e as Error));
          }
        },
        onmessage: (msg: LiveServerMessage) => {
          if (attemptRef.current !== myAttempt) return;
          void handleMessage(msg);
        },
        onerror: (e: ErrorEvent) => {
          onErrorRef.current?.(new Error(e.message || "session error"));
        },
        onclose: (e: CloseEvent) => {
          if (attemptRef.current !== myAttempt) return;
          setMetrics((m) => ({ ...m, disconnects: m.disconnects + 1 }));
          if (stateRef.current !== "disconnected") setStateSafe("disconnected");
          void e;
        },
      },
    });
    if (attemptRef.current !== myAttempt) {
      try {
        session.close();
      } catch {
        /* ignore */
      }
      return;
    }
    sessionRef.current = session;
    // prompt() が使えるのは sessionRef 代入後。onopen ではなくここで listening にする。
    if (attemptRef.current === myAttempt && stateRef.current === "connecting") setStateSafe("listening");
  }, [setStateSafe, handleServerMessage, startCapture]);

  /** 会話中の文脈追加（応答を誘発しない）。接近後の属性1枚推定用。 */
  const injectContext = useCallback((text: string) => {
    try {
      sessionRef.current?.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: false,
      });
    } catch (e) {
      console.error("[Gemini] inject failed:", e);
    }
  }, []);

  /** テキストでターンを投げて応答を誘発する（DJのMC用） */
  const prompt = useCallback((text: string) => {
    try {
      sessionRef.current?.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    } catch (e) {
      console.error("[Gemini] prompt failed:", e);
    }
  }, []);

  /** MC音声のミュート（音楽側とは別のバス） */
  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    const gain = playGainRef.current;
    const ctx = playCtxRef.current;
    if (gain && ctx) gain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
  }, []);

  /** 手動ターン確定 */
  const commitUtterance = useCallback(() => {
    try {
      void sessionRef.current?.sendRealtimeInput({ activityEnd: {} });
    } catch (e) {
      console.error("[Gemini] commit failed:", e);
    }
  }, []);

  const disconnect = useCallback(() => {
    attemptRef.current++;
    try {
      sessionRef.current?.close();
    } catch {
      /* ignore */
    }
    sessionRef.current = null;
    stopCapture();
    stopPlayback();
    setVia("");
    setStateSafe("disconnected");
  }, [stopCapture, stopPlayback, setStateSafe]);

  useEffect(() => {
    if (state === "disconnected" || state === "error") {
      stopCapture();
      stopPlayback();
    }
  }, [state, stopCapture, stopPlayback]);

  // unmount時の後始末はdisconnectと同一ヘルパー経由に集約
  // (disconnect本体は呼ばない: setState/setVia不要・attempt加算不要のため。挙動同一)
  useEffect(() => {
    return () => {
      try {
        sessionRef.current?.close();
      } catch {
        /* ignore */
      }
      sessionRef.current = null;
      stopCapture();
      stopPlayback();
      void playCtxRef.current?.close().catch(() => {});
      playCtxRef.current = null;
      playGainRef.current = null;
    };
  }, [stopCapture, stopPlayback]);

  return {
    state,
    via,
    connect,
    disconnect,
    commitUtterance,
    injectContext,
    prompt,
    setMuted,
    resetTranscript,
    log,
    metrics,
    isConnected: state !== "disconnected" && state !== "error" && state !== "connecting",
    micLevel,
    outLevel,
  };
}
