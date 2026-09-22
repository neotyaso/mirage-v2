import { Status, Zone, Phase, Interaction } from "./types";

export const STATUS_COLORS: Record<Status, string> = {
  ONLINE: "bg-green-500",
  OFFLINE: "bg-gray-400",
};

export const PHASE_COLORS: Record<Phase, string> = {
  IDLE: "bg-gray-500",
  APPROACH: "bg-blue-500",
  ENGAGE: "bg-green-500",
  LEAVE: "bg-orange-500",
};

export const ZONE_COLORS: Record<Zone, string> = {
  A: "bg-red-500",
  B: "bg-blue-500",
  C: "bg-yellow-500",
  IDLE: "bg-gray-500",
};

export const MOCK_INTERACTIONS: Interaction[] = [
  { id: "1", time: "10:30:15", zone: "A", phase: "ENGAGE", attention: 0.92, conversation: "挨拶", action: "手を振る" },
  { id: "2", time: "10:30:42", zone: "A", phase: "ENGAGE", attention: 0.88, conversation: "質問", action: "うなずく" },
  { id: "3", time: "10:31:10", zone: "B", phase: "APPROACH", attention: 0.45, conversation: "待機", action: "見る" },
  { id: "4", time: "10:31:55", zone: "B", phase: "ENGAGE", attention: 0.78, conversation: "説明", action: "指差す" },
  { id: "5", time: "10:32:20", zone: "C", phase: "LEAVE", attention: 0.12, conversation: "別れ", action: "手を振る" },
];