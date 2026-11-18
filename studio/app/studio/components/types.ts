export type Status = "ONLINE" | "OFFLINE";
export type Zone = "A" | "B" | "C" | "IDLE";
export type Phase = "IDLE" | "APPROACH" | "ENGAGE" | "LEAVE";

export interface Interaction {
  id: string;
  time: string;
  zone: Zone;
  phase: Phase;
  attention: number;
  conversation: string;
  action: string;
}