import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { estimateDistanceM } from "./useFaceDetection";
import type { FaceCenter, FaceExpression } from "./useFaceDetection";
// 接近時1回だけ会話エンジンに渡す1行文脈。毎フレーム投げないイベント駆動用。
// ponytail: 閾値固定、現場で外したら定数だけ調整、分類器は足さない
export function buildVisitorContext(expr: FaceExpression | undefined, vd?: number | null): string {
  const parts: string[] = [];
  const mood = MOOD_JA[moodOf(expr)];
  if (mood) parts.push(mood);
  if (vd !== undefined && vd !== null && vd < -0.8) parts.push("急ぎ足で接近");
  return parts.join("、");
}
import { CONVERSATION_START_LINES, FAREWELL_LINES } from "./useConversationEngine";
import type { ConversationEngine } from "./useConversationEngine";
import { createVisitorTracker } from "../tracking/visitorTracker";
import type { VisitorTracker } from "../tracking/visitorTracker";
import { generateVisionComment } from "../vision/visionComment";
import { MOOD_JA, moodOf } from "../vision/expression";
import { ZONE_MID_M } from "../tracking/types";
import { createEventLog } from "../tracking/eventLog";
import type { EventLog } from "../tracking/eventLog";
import type { FaceObservation } from "../tracking/types";

const AWAY_TIMEOUT_MS = 4000; // これだけ不在が続いたら「離れた」と判断（顔検出の一瞬の途切れで切れないように）

export interface VisitorLoopInput {
  started: boolean;
  paused: boolean;
  eng: ConversationEngine;
  presentRef: RefObject<boolean>;
  videoRef: RefObject<HTMLVideoElement | null>;
  faceCenterRef: RefObject<FaceCenter | null>;
  faceSizeRef: RefObject<number>;
  eyeDistanceRef: RefObject<number>;
  speakingRef: RefObject<boolean>;
  say: (text: string) => void;
  allFaceCentersRef: RefObject<FaceCenter[]>;
  allFaceSizesRef: RefObject<number[]>;
  allEyeDistancesRef: RefObject<number[]>;
  faceYawRef: RefObject<number>;
  expressionRef: RefObject<FaceExpression>;
}

// 距離による会話の開始/終了の判断。150msごとにrefを読むだけ（再描画なし）。
// P3: d<=ZONE_MID_M(1.4m)で会話開始。不在が続けば切断＋別れの一言＋履歴リセット。
// 同じ150ms tickで通行人トラッキングも回す（滞在=lastSeen-firstSeen、zones遷移、leave時にeventLogへ）。
export function useVisitorLoop({ started, paused, eng, presentRef, videoRef, faceCenterRef, faceSizeRef, eyeDistanceRef, speakingRef, say, allFaceCentersRef, allFaceSizesRef, allEyeDistancesRef, faceYawRef, expressionRef }: VisitorLoopInput) {
  const activeConvState = eng.activeConvState;
  const lastPresentAtRef = useRef(performance.now());
  // 実際に会話ログがあるか（離脱時の別れの一言を言うか判定用）。
  // setInterval側のクロージャがconvState変化時にしか作り直されず、logの更新を都度拾えないためrefで同期する
  const hasLogRef = useRef(false);
  const trackerRef = useRef<VisitorTracker | null>(null);
  const eventLogRef = useRef<EventLog | null>(null);
  if (trackerRef.current === null) trackerRef.current = createVisitorTracker();
  if (eventLogRef.current === null) eventLogRef.current = createEventLog();
  // 接近時1枚visionの発火ガード（会話ごとに1回）。非同期解決後のinjectはref経由で最新を使う
  const visionFiredRef = useRef(false);
  // P5: 会話中の表情変化を追注入するための状態（安定1.5秒・最短10秒）
  const moodRef = useRef({ label: "", since: 0, lastAt: 0, lastLabel: "" });
  const injectRef = useRef(eng.injectContext);
  injectRef.current = eng.injectContext;
  useEffect(() => {
    hasLogRef.current = eng.displayLog.length > 0;
  }, [eng.displayLog]);
  // P6: local遅延metricsをtick側で読む用。visitorIdは付けない(遅延はセッション単位の統計値のため)
  const localMetricsRef = useRef(eng.localMetrics);
  const lastLatencyTurnRef = useRef(0);
  useEffect(() => {
    localMetricsRef.current = eng.localMetrics;
  }, [eng.localMetrics]);
  // P22: 検索ツールの実行記録。実行のたびに1件だけeventLogへ足す
  const geminiMetricsRef = useRef(eng.geminiMetrics);
  const lastToolRunRef = useRef(0);
  useEffect(() => {
    geminiMetricsRef.current = eng.geminiMetrics;
  }, [eng.geminiMetrics]);

  useEffect(() => {
    const id = setInterval(() => {
      const p = presentRef.current;
      const d = estimateDistanceM(faceSizeRef.current, eyeDistanceRef.current);
      const inRange = d !== null && d <= ZONE_MID_M;
      const now = performance.now();

      // 通行人トラッキング（滞在・ゾーン遷移用）。会話の開始/終了とは独立に回す。
      const tracker = trackerRef.current;
      const eventLog = eventLogRef.current;
      if (tracker && eventLog && started && !paused) {
        const centers = allFaceCentersRef.current ?? [];
        const sizes = allFaceSizesRef.current ?? [];
        const ipds = allEyeDistancesRef.current ?? [];
        const faces: FaceObservation[] = centers.map((c, i) => {
          const size = sizes[i] ?? 0;
          const ipd = ipds[i] ?? 0;
          const obs: FaceObservation = { x: c.x, y: c.y, size, ipd, d: estimateDistanceM(size, ipd) };
          // ponytail: 表情は主対象(単顔≒全員)のみ付与、多人数の個別表情は別途allExpressions化が必要
          const primary = faceCenterRef.current;
          if (primary && Math.hypot(c.x - primary.x, c.y - primary.y) < 0.02) {
            obs.smile = expressionRef.current?.smile ?? 0;
            obs.yaw = faceYawRef.current ?? 0;
          }
          return obs;
        });
        const { left } = tracker.update(faces, now);
        for (const v of left) {
          eventLog.append("leave", v.id, { stayMs: v.lastSeenMs - v.firstSeenMs }, { t: now });
        }
      }

      // P6: localターン確定で遅延3区間をeventLogへ(中央値集計用)。gemini本線はS2Sで分離不可のため対象外
      const latencyLog = eventLogRef.current;
      const lm = localMetricsRef.current;
      if (latencyLog && lm.turns > lastLatencyTurnRef.current) {
        lastLatencyTurnRef.current = lm.turns;
        if (lm.sttMs !== null) latencyLog.append("stt_final", null, { ms: lm.sttMs, turn: lm.turns });
        if (lm.llmMs !== null) latencyLog.append("llm_first_token", null, { ms: lm.llmMs, turn: lm.turns });
        if (lm.ttsFirstMs !== null) latencyLog.append("tts_first_audio", null, { ms: lm.ttsFirstMs, turn: lm.turns, turnMs: lm.turnMs });
      }

      // P22: 検索の有無・所要時間・成否を残す（P23で集計）
      const gm = geminiMetricsRef.current;
      if (latencyLog && gm.toolRuns > lastToolRunRef.current) {
        lastToolRunRef.current = gm.toolRuns;
        const t = gm.lastTool;
        if (t) latencyLog.append("web_search", null, { tool: t.name, query: t.query, ms: Math.round(t.ms), ok: t.ok });
      }

      if (p) lastPresentAtRef.current = now;
      if (started && !paused) {
        if (activeConvState === "idle") visionFiredRef.current = false;
        if (inRange && activeConvState === "idle") {
          // 会話開始の瞬間は必ず一言喋って「聞く態勢に入った」ことを分かりやすくする
          say(CONVERSATION_START_LINES[Math.floor(Math.random() * CONVERSATION_START_LINES.length)]);
          // P5: 接近時1回だけ表情+接近速度を1行文脈として注入（毎フレーム投げない）
          const active = tracker?.getActive() ?? [];
          const vd = active[0]?.vd ?? null;
          const visitorId = active[0]?.id ?? null;
          const ctx = buildVisitorContext(expressionRef.current, vd);
          eventLog?.append("conversation_start", visitorId, ctx ? { context: ctx } : undefined, { t: now });
          if (eng.engine === "local") {
            if (!eng.localWantedRef.current) eng.startLocal(ctx || undefined);
          } else {
            eng.connect(ctx || undefined);
          }
          // 開始時に表情を伝えているので、直後の追注入はしない
          moodRef.current.lastAt = now;
          moodRef.current.lastLabel = moodOf(expressionRef.current);
          // P5属性: 接近時1枚だけ服装推定→会話中コンテキストに追注入（会話開始は待たない）
          // ponytail: SKIP/null時は注入なし、会話終了後の解決は破棄
          if (!visionFiredRef.current) {
            visionFiredRef.current = true;
            const video = videoRef.current;
            void generateVisionComment(video).then((attire) => {
              if (!attire) return;
              injectRef.current(`[来場者服装: ${attire}] 外見を褒めずに自然に触れて。`);
            }).catch(() => {});
          }
        }
        // P5: 会話中に表情が大きく変わったら、その表情を文脈へ追注入する。
        // 同じ表情で連投しない（安定1.5秒・最短10秒・同じ表情は1回）
        if (activeConvState === "idle") {
          // 開始時に伝えた表情を直後に繰り返さないよう、lastAt/lastLabel は残す
          moodRef.current.label = "";
          moodRef.current.since = 0;
        } else {
          const m = moodRef.current;
          const mood = moodOf(expressionRef.current);
          if (mood === "neutral") {
            m.label = "";
            m.lastLabel = "";
          } else if (mood !== m.label) {
            m.label = mood;
            m.since = now;
          } else if (
            eng.engine === "gemini" &&
            now - m.since > 1500 &&
            now - m.lastAt > 10000 &&
            m.lastLabel !== mood
          ) {
            injectRef.current(`[来場者の表情: ${MOOD_JA[mood]}]`);
            m.lastAt = now;
            m.lastLabel = mood;
          }
        }

        if (activeConvState !== "idle" && now - lastPresentAtRef.current > AWAY_TIMEOUT_MS) {
          // 実際にやり取りがあった（ログが残っている）場合だけ別れの一言を挟む
          if (hasLogRef.current) {
            say(FAREWELL_LINES[Math.floor(Math.random() * FAREWELL_LINES.length)]);
          }
          eng.endConversation();
        }
      }
    }, 150);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, paused, activeConvState, eng.engine]);

  return { trackerRef, eventLogRef };
}
