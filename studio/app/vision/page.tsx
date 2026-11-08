"use client";

import { useEffect, useRef, useState } from "react";
import { useVisionRtcReceiver } from "./useVisionRtcReceiver";

type Box = { x: number; y: number; w: number; h: number };
type Expressions = { smile: number; surprised: number; confused: number };
type Live = {
  at?: number;
  frame?: string;
  expressions?: Expressions;
  face?: { count: number; box: Box | null };
  distanceM?: number | null;
  yaw?: number;
};

function endpoint() {
  return location.pathname.startsWith("/studio")
    ? "/studio/api/vision/live/stream"
    : "/api/vision/live/stream";
}

function dominant(e?: Expressions) {
  if (!e) return "-";
  if (e.confused > 0.5) return "困惑";
  if (e.smile > 0.6) return "笑顔";
  if (e.surprised > 0.5) return "驚き";
  return "ふつう";
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-mono text-gray-900">{value.toFixed(2)}</span>
      </div>
      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-150 ${color}`}
          style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function VisionPage() {
  const [live, setLive] = useState<Live | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rtc = useVisionRtcReceiver(videoRef);

  useEffect(() => {
    // SSEで届いた瞬間に描画する（ポーリング待ちなし）。切れたら自動再接続。
    const es = new EventSource(endpoint());
    es.onmessage = (e) => {
      try {
        setLive(JSON.parse(e.data) as Live);
        setError(false);
      } catch {
        /* 壊れた1件は捨てる */
      }
    };
    es.onerror = () => setError(true);
    const tick = setInterval(() => setNow(Date.now()), 100);
    return () => {
      es.close();
      clearInterval(tick);
    };
  }, []);

  const age = live?.at ? Math.max(0, now - live.at) : Infinity;
  const stale = !live?.frame || age > 1200;
  // WebRTC が繋がっていれば映像は最新（SSEは表情・枠用）
  const liveNow = rtc === "connected" || !stale;
  const box = live?.face?.box ?? null;
  const expr = live?.expressions;
  const yawDeg = live ? Math.round((live.yaw ?? 0) * (180 / Math.PI)) : 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Live Vision</h2>
          <p className="text-sm text-gray-500">
            Mirage のカメラと表情トラッキングをリアルタイム表示します。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
              liveNow ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${liveNow ? "bg-green-500" : "bg-gray-400"}`} />
            {liveNow ? "Live" : "Waiting for Mirage"}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
              rtc === "connected"
                ? "bg-blue-100 text-blue-700"
                : rtc === "connecting"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-500"
            }`}
          >
            {rtc === "connected" ? "WebRTC" : rtc === "connecting" ? "接続中" : "JPEG"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="relative aspect-[4/3] bg-gray-900">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                rtc === "connected" ? "opacity-100" : "opacity-0"
              }`}
            />
            {rtc !== "connected" && live?.frame && (
              // WebRTC 接続までのフォールバック（約10fpsのJPEG）
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={live.frame}
                alt="Mirage camera"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            {!live?.frame && rtc !== "connected" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 text-sm">
                <span className="text-3xl">◉</span>
                <span>Mirage からの映像を待っています</span>
                <span className="text-xs">
                  http://localhost:5173 を開いてカメラを許可してください
                </span>
              </div>
            )}

            {box && (
              <>
                <div
                  className="absolute border-2 border-green-400 rounded-md shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]"
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.w * 100}%`,
                    height: `${box.h * 100}%`,
                  }}
                />
                <div
                  className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-400 ring-2 ring-black/30"
                  style={{ left: `${(box.x + box.w / 2) * 100}%`, top: `${(box.y + box.h / 2) * 100}%` }}
                />
              </>
            )}

            <div className="absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-xs font-mono text-white">
              {live?.face?.count ?? 0} face{(live?.face?.count ?? 0) === 1 ? "" : "s"} /{" "}
              {dominant(expr)}
            </div>
            {!stale && (
              <div className="absolute right-3 top-3 rounded-md bg-black/55 px-2 py-1 text-xs font-mono text-white">
                {Math.round(age)} ms ago
              </div>
            )}
          </div>
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <span>映像は WebRTC（P2P）。顔枠・表情はSSE（約10fps）。未接続時は160px JPEGに自動フォールバック。保存しません。</span>
            {error && <span className="text-amber-600">Studio API に接続できません</span>}
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
          <div>
            <h3 className="text-sm font-bold text-gray-900">表情（blendshape）</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              口角・眉・目の開きから推定。主対象の顔のみ。
            </p>
          </div>
          <div className="space-y-3">
            <Bar label="笑顔" value={expr?.smile ?? 0} color="bg-emerald-400" />
            <Bar label="驚き" value={expr?.surprised ?? 0} color="bg-amber-400" />
            <Bar label="困惑" value={expr?.confused ?? 0} color="bg-rose-400" />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-bold text-gray-900 mb-2">トラッキング</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">推定距離</dt>
                <dd className="font-mono text-gray-900">
                  {live?.distanceM ? `${live.distanceM.toFixed(2)} m` : "-"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">顔の向き (yaw)</dt>
                <dd className="font-mono text-gray-900">{live ? `${yawDeg}°` : "-"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">検出人数</dt>
                <dd className="font-mono text-gray-900">{live?.face?.count ?? 0}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">会話文脈</dt>
                <dd className="font-mono text-gray-900">
                  {dominant(expr) === "ふつう" ? "（注入なし）" : dominant(expr)}
                </dd>
              </div>
            </dl>
          </div>

          <p className="text-xs leading-relaxed text-gray-500 border-t border-gray-100 pt-4">
            表情は会話開始時の文脈に加え、会話中も大きく変わったときだけ
            （安定1.5秒・最短10秒間隔で）Gemini Live に追注入します。
          </p>
        </section>
      </div>
    </>
  );
}
