import type { DanceMove, DanceStyle } from "./dance";

export type ShowMode = "idle" | "walk" | "talk" | "dance";
export type TrackId = "neon";
export type MarkId = "center" | "left" | "right" | "front";

export const TRACKS: Record<TrackId, { name: string; bpm: number; file: string }> = {
  neon: {
    name: "DANCE ELECTRO",
    bpm: 120,
    file: "/audio/dance-electro-120.mp3",
  },
};

export const MARKS: Record<MarkId, { x: number; z: number }> = {
  center: { x: 0, z: 0 },
  left: { x: -1.15, z: 0.1 },
  right: { x: 1.15, z: 0.1 },
  front: { x: 0, z: 0.9 },
};

export type ShowState = {
  mode: ShowMode;
  trackId: TrackId;
  trackName: string;
  bpm: number;
  playing: boolean;
  bar: number;
  beat: number;
  style: DanceStyle;
  energy: number;
};

export type ShowAction =
  | {
      type: "dance";
      bpm?: number;
      energy?: number;
      style?: DanceStyle;
      moves?: DanceMove[];
    }
  | { type: "stopMusic"; fadeBars?: number }
  | { type: "playTrack"; trackId: TrackId }
  | { type: "walkTo"; mark: MarkId }
  | { type: "talk" }
  | { type: "gesture"; intent: "wave" | "nod" | "point" | "celebrate" }
  | { type: "setClip"; clip: string };
