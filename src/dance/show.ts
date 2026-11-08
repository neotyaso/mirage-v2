export type ShowMode = "idle" | "walk" | "talk" | "dance";
export type TrackId = "neon" | "pulse";
export type MarkId = "center" | "left" | "right" | "front";

export const TRACKS: Record<
  TrackId,
  { name: string; bpm: number; bass: number[]; chords: [number, number] }
> = {
  neon: {
    name: "NEON DRIVE",
    bpm: 112,
    bass: [55, 55, 65.41, 49, 55, 55, 73.42, 65.41],
    chords: [220, 261.63],
  },
  pulse: {
    name: "PULSE",
    bpm: 128,
    bass: [49, 49, 58.27, 43.65, 49, 49, 65.41, 58.27],
    chords: [196, 246.94],
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
};

export type ShowAction =
  | { type: "dance"; bpm?: number; energy?: number }
  | { type: "stopMusic"; fadeBars?: number }
  | { type: "playTrack"; trackId: TrackId }
  | { type: "walkTo"; mark: MarkId }
  | { type: "talk" }
  | { type: "gesture"; intent: "wave" | "nod" | "point" | "celebrate" }
  | { type: "setClip"; clip: string };

export function nextTrack(id: TrackId): TrackId {
  return id === "neon" ? "pulse" : "neon";
}
