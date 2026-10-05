import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { estimateDistanceM } from "./useFaceDetection";
import type { FaceCenter } from "./useFaceDetection";
import { CONVERSATION_START_LINES, FAREWELL_LINES } from "./useConversationEngine";
import type { ConversationEngine } from "./useConversationEngine";
import { createVisitorTracker } from "../tracking/visitorTracker";
import type { VisitorTracker } from "../tracking/visitorTracker";
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
  faceSizeRef: RefObject<number>;
  eyeDistanceRef: RefObject<number>;
  speakingRef: RefObject<boolean>;
  say: (text: string) => void;
  allFaceCentersRef: RefObject<FaceCenter[]>;
  allFaceSizesRef: RefObject<number[]>;
  allEyeDistancesRef: RefObject<number[]>;
}

// 距離による会話の開始/終了の判断。150msごとにrefを読むだけ（再描画なし）。
// P3: d<=ZONE_MID_M(1.4m)で会話開始。不在が続けば切断＋別れの一言＋履歴リセット。
// 同じ150ms tickで通行人トラッキングも回す（滞在=lastSeen-firstSeen、zones遷移、leave時にeventLogへ）。
export function useVisitorLoop({ started, paused, eng, presentRef, faceSizeRef, eyeDistanceRef, speakingRef, say, allFaceCentersRef, allFaceSizesRef, allEyeDistancesRef }: VisitorLoopInput) {
  const activeConvState = eng.activeConvState;
  const lastPresentAtRef = useRef(performance.now());
  // 実際に会話ログがあるか（離脱時の別れの一言を言うか判定用）。
  // setInterval側のクロージャがconvState変化時にしか作り直されず、logの更新を都度拾えないためrefで同期する
  const hasLogRef = useRef(false);
  const trackerRef = useRef<VisitorTracker | null>(null);
  const eventLogRef = useRef<EventLog | null>(null);
  if (trackerRef.current === null) trackerRef.current = createVisitorTracker();
  if (eventLogRef.current === null) eventLogRef.current = createEventLog();
  useEffect(() => {
    hasLogRef.current = eng.displayLog.length > 0;
  }, [eng.displayLog]);

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
          return { x: c.x, y: c.y, size, ipd, d: estimateDistanceM(size, ipd) };
        });
        const { left } = tracker.update(faces, now);
        for (const v of left) {
          eventLog.append("leave", v.id, { stayMs: v.lastSeenMs - v.firstSeenMs }, { t: now });
        }
      }

      if (p) lastPresentAtRef.current = now;
      if (started && !paused) {
        if (inRange && activeConvState === "idle") {
          // 会話開始の瞬間は必ず一言喋って「聞く態勢に入った」ことを分かりやすくする
          say(CONVERSATION_START_LINES[Math.floor(Math.random() * CONVERSATION_START_LINES.length)]);
          if (eng.engine === "local") {
            if (!eng.localWantedRef.current) eng.startLocal();
          } else {
            eng.connect();
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
