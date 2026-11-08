/**
 * ダンスの核。拍・小節から身体のオフセットを決める純関数。
 * Three.js には依存しないので、ブラウザ無しでテストできる。
 *
 * 90%側: 常時動く base groove（bounce / sway / hip / head）に、
 * 小節ごとの atom（stepTouch / armWave / point / spin / pose）を重ねる。
 */

export const DANCE_STYLES = ["cute", "cool", "hype", "chill"] as const;
export type DanceStyle = (typeof DANCE_STYLES)[number];

export const DANCE_MOVES = [
  "bounce",
  "sway",
  "stepTouch",
  "armWave",
  "point",
  "spin",
  "pose",
  "headNod",
] as const;
export type DanceMove = (typeof DANCE_MOVES)[number];

export const DANCE_BONES = [
  "Hips",
  "Abdomen",
  "Torso",
  "Neck",
  "Head",
  "UpperArm.L",
  "LowerArm.L",
  "UpperArm.R",
  "LowerArm.R",
  "UpperLeg.L",
  "LowerLeg.L",
  "UpperLeg.R",
  "LowerLeg.R",
] as const;
export type DanceBone = (typeof DANCE_BONES)[number];

/** ボーンごとのローカル回転オフセット（XYZ, rad）。 */
export type BoneOffset = [number, number, number];

export type DanceCue = {
  style: DanceStyle;
  energy: number;
  moves: DanceMove[];
};

export type DanceClock = {
  phase: number; // 拍内 0..1
  beat: number; // 0..3
  bar: number;
  playing: boolean;
};

export type DancePose = {
  rootX: number;
  rootY: number;
  rootYaw: number;
  rootRoll: number;
  bones: Partial<Record<DanceBone, BoneOffset>>;
  accent: number; // 0..1。ライトや小道具のキック用
};

type StyleProfile = {
  bounce: number;
  sway: number;
  hip: number;
  arm: number;
  head: number;
  moves: DanceMove[];
};

const STYLES: Record<DanceStyle, StyleProfile> = {
  cute: { bounce: 0.9, sway: 1.1, hip: 1.2, arm: 0.75, head: 1.1, moves: ["stepTouch", "sway", "armWave", "pose"] },
  cool: { bounce: 0.6, sway: 0.7, hip: 0.75, arm: 1.05, head: 0.55, moves: ["bounce", "point", "sway", "pose"] },
  hype: { bounce: 1.3, sway: 0.9, hip: 0.85, arm: 1.3, head: 1.2, moves: ["bounce", "armWave", "stepTouch", "spin"] },
  chill: { bounce: 0.5, sway: 1.2, hip: 1.1, arm: 0.55, head: 0.8, moves: ["sway", "stepTouch", "pose", "sway"] },
};

const TAU = Math.PI * 2;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function isDanceStyle(value: unknown): value is DanceStyle {
  return typeof value === "string" && (DANCE_STYLES as readonly string[]).includes(value);
}

export function isDanceMove(value: unknown): value is DanceMove {
  return typeof value === "string" && (DANCE_MOVES as readonly string[]).includes(value);
}

/** style ごとの既定の atom 並び。UI のクイック指示と MC の初期値で使う。 */
export function defaultMoves(style: DanceStyle): DanceMove[] {
  return [...STYLES[style].moves];
}

/** 部分更新を現在の cue にマージする。省略した項目は変えない。 */
export function mergeDanceCue(prev: DanceCue, input: Partial<DanceCue>): DanceCue {
  const style = isDanceStyle(input.style) ? input.style : prev.style;
  return {
    style,
    energy: clamp(finite(input.energy, prev.energy), 0.2, 1),
    moves: Array.isArray(input.moves)
      ? input.moves.filter(isDanceMove).slice(0, 8)
      : style !== prev.style
        ? defaultMoves(style)
        : prev.moves,
  };
}

function add(bones: DancePose["bones"], bone: DanceBone, x: number, y: number, z: number) {
  const prev = bones[bone];
  if (prev) {
    prev[0] += x;
    prev[1] += y;
    prev[2] += z;
  } else {
    bones[bone] = [x, y, z];
  }
}

function emptyPose(): DancePose {
  return {
    rootX: 0,
    rootY: 0,
    rootYaw: 0,
    rootRoll: 0,
    bones: {},
    accent: 0,
  };
}

/**
 * 1フレーム分のダンス姿勢を返す。
 * 呼び出し側は返り値をそのままルートとボーンに適用し、補間は適用側で行う。
 */
export function sampleDance(clock: DanceClock, cue: DanceCue): DancePose {
  const pose = emptyPose();
  if (!clock.playing) return pose;

  const profile = STYLES[cue.style];
  const energy = clamp(finite(cue.energy, 0.7), 0.2, 1);
  const amp = 0.35 + 0.65 * energy;
  const phase = ((clock.phase % 1) + 1) % 1;
  const beat = clamp(Math.floor(finite(clock.beat, 0)) % 4, 0, 3);
  const bar = Math.max(0, Math.floor(finite(clock.bar, 0)));
  const beatPos = beat + phase;
  const barPhase = beatPos / 4;
  const wave = Math.sin(barPhase * TAU);
  const bounce = Math.abs(Math.sin(phase * Math.PI));
  const accent = (beat === 0 ? 1 : 0.35) * Math.exp(-phase * 5) * energy;
  const move =
    cue.moves.length > 0
      ? cue.moves[bar % cue.moves.length]
      : profile.moves[bar % profile.moves.length];

  // 常時動く base groove。ここだけで「音楽に乗っている」感を作る。
  pose.rootY = bounce * (0.012 + 0.035 * energy) * profile.bounce + (beat === 0 ? accent * 0.006 : 0);
  pose.rootX = wave * (0.03 + 0.05 * energy) * profile.sway;
  pose.rootYaw = wave * (0.03 + 0.06 * energy) * profile.hip;
  pose.rootRoll = -wave * (0.015 + 0.03 * energy) * profile.hip;
  pose.accent = accent;

  add(pose.bones, "Hips", 0, -wave * 0.15 * profile.hip * amp, wave * 0.08 * profile.hip * amp);
  add(pose.bones, "Abdomen", 0, wave * 0.08 * profile.hip * amp, -wave * 0.05 * profile.hip * amp);
  add(pose.bones, "Torso", 0, wave * 0.05 * profile.hip * amp, -wave * 0.03 * profile.hip * amp);
  add(pose.bones, "Neck", 0, -wave * 0.04 * profile.head * amp, wave * 0.03 * profile.head * amp);
  add(
    pose.bones,
    "Head",
    -Math.sin(phase * TAU) * 0.05 * profile.head * amp - (beat === 0 ? accent * 0.04 : 0),
    wave * 0.07 * profile.head * amp,
    -wave * 0.05 * profile.head * amp,
  );

  // 腕はベースで小さく振り、atom で大きく動かす。
  add(pose.bones, "UpperArm.L", 0, 0, wave * 0.1 * profile.arm * amp);
  add(pose.bones, "LowerArm.L", 0, 0, Math.max(0, wave) * 0.08 * profile.arm * amp);
  add(pose.bones, "UpperArm.R", 0, 0, -wave * 0.1 * profile.arm * amp);
  add(pose.bones, "LowerArm.R", 0, 0, -Math.max(0, -wave) * 0.08 * profile.arm * amp);
  add(pose.bones, "UpperLeg.L", bounce * 0.04 * amp, 0, 0);
  add(pose.bones, "LowerLeg.L", bounce * 0.05 * amp, 0, 0);
  add(pose.bones, "UpperLeg.R", bounce * 0.04 * amp, 0, 0);
  add(pose.bones, "LowerLeg.R", bounce * 0.05 * amp, 0, 0);

  switch (move) {
    case "bounce":
      pose.rootY += bounce * 0.012 * amp;
      add(pose.bones, "UpperLeg.L", bounce * 0.04 * amp, 0, 0);
      add(pose.bones, "UpperLeg.R", bounce * 0.04 * amp, 0, 0);
      add(pose.bones, "LowerLeg.L", bounce * 0.06 * amp, 0, 0);
      add(pose.bones, "LowerLeg.R", bounce * 0.06 * amp, 0, 0);
      break;
    case "sway":
      pose.rootX += wave * 0.05 * amp;
      add(pose.bones, "Hips", 0, wave * 0.08 * amp, -wave * 0.05 * amp);
      add(pose.bones, "Head", 0, -wave * 0.06 * amp, wave * 0.04 * amp);
      break;
    case "stepTouch": {
      const side = Math.sin(barPhase * TAU);
      pose.rootX += side * 0.09 * amp;
      pose.rootYaw += side * 0.12 * amp;
      add(pose.bones, "Hips", 0, side * 0.08 * amp, side * 0.06 * amp);
      add(pose.bones, "UpperLeg.L", -side * 0.16 * amp, 0, 0);
      add(pose.bones, "UpperLeg.R", side * 0.16 * amp, 0, 0);
      add(pose.bones, "LowerLeg.L", Math.max(0, -side) * 0.2 * amp, 0, 0);
      add(pose.bones, "LowerLeg.R", Math.max(0, side) * 0.2 * amp, 0, 0);
      add(pose.bones, "UpperArm.L", 0, 0, -side * 0.12 * amp);
      add(pose.bones, "UpperArm.R", 0, 0, -side * 0.12 * amp);
      break;
    }
    case "armWave": {
      const up = Math.sin(barPhase * TAU);
      const left = Math.max(0, up);
      const right = Math.max(0, -up);
      // UpperArm のローカルXが腕を外側へ持ち上げる軸。
      add(pose.bones, "UpperArm.L", left * 1.2 * amp, 0, 0);
      add(pose.bones, "UpperArm.R", right * 1.2 * amp, 0, 0);
      add(pose.bones, "Head", 0, up * 0.08 * amp, 0);
      break;
    }
    case "point": {
      const p = Math.sin(barPhase * TAU);
      const right = Math.max(0, p);
      const left = Math.max(0, -p);
      add(pose.bones, "UpperArm.R", 0.85 * right * amp, 0, 0.2 * right * amp);
      add(pose.bones, "UpperArm.L", 0.3 * left * amp, 0, 0);
      add(pose.bones, "Head", 0, (right - left) * 0.12 * amp, 0);
      break;
    }
    case "spin":
      // 1小節で1回転。次の小節の base に戻るときは適用側が角度を補間する。
      pose.rootYaw += barPhase * TAU;
      pose.rootY += 0.01 * Math.sin(barPhase * Math.PI) * amp;
      break;
    case "pose": {
      const env = Math.sin(barPhase * Math.PI);
      pose.rootY += 0.02 * env * amp;
      add(pose.bones, "Hips", 0, 0.12 * env * amp, 0);
      add(pose.bones, "UpperArm.L", 1.15 * env * amp, 0, 0);
      add(pose.bones, "UpperArm.R", 1.15 * env * amp, 0, 0);
      add(pose.bones, "Head", 0, 0.15 * env * amp, 0);
      break;
    }
    case "headNod":
      add(pose.bones, "Head", -Math.sin(phase * TAU) * 0.12 * amp, 0, 0);
      break;
  }

  return pose;
}
