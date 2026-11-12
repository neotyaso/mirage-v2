import type { DanceMove, DanceStyle } from "./dance";

export type ShowMode = "idle" | "walk" | "talk" | "dance";
export type TrackId = "neon";
export type SectionId = "intro" | "build" | "drop" | "break" | "outro";
export type MarkId = "center" | "left" | "right" | "front";

export type TrackSection = {
  id: SectionId;
  /** 0始まりの小節番号。 */
  startBar: number;
  style: DanceStyle;
  energy: number;
};

export type Track = {
  name: string;
  bpm: number;
  file: string;
  /** 曲頭から最初のダウンビートまでの秒数。 */
  firstBeat: number;
  /** ループ1周の小節数。 */
  bars: number;
  sections: TrackSection[];
};

// Dance Electro 120 bpm - Full の解析結果。
// 0.987s が最初のダウンビート、2秒（4拍）ごとの小節。
// 8小節 intro → 16 drop → 8 break → 8 build → 16 drop → outro。
export const TRACKS: Record<TrackId, Track> = {
  neon: {
    name: "DANCE ELECTRO",
    bpm: 120,
    file: "/audio/dance-electro-120.mp3",
    firstBeat: 0.987,
    bars: 60,
    sections: [
      { id: "intro", startBar: 0, style: "chill", energy: 0.4 },
      { id: "drop", startBar: 8, style: "hype", energy: 0.92 },
      { id: "drop", startBar: 16, style: "cool", energy: 0.88 },
      { id: "break", startBar: 24, style: "cute", energy: 0.58 },
      { id: "build", startBar: 32, style: "chill", energy: 0.7 },
      { id: "drop", startBar: 40, style: "hype", energy: 0.94 },
      { id: "drop", startBar: 48, style: "cool", energy: 0.9 },
      { id: "outro", startBar: 56, style: "chill", energy: 0.35 },
    ],
  },
};

/** 曲のループ内の小節から、その小節のセクションを返す。 */
export function sectionAtBar(track: Track, bar: number): TrackSection {
  const wrapped = ((bar % track.bars) + track.bars) % track.bars;
  let section = track.sections[0];
  for (const candidate of track.sections) {
    if (candidate.startBar <= wrapped) section = candidate;
  }
  return section;
}

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
  section: SectionId;
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
