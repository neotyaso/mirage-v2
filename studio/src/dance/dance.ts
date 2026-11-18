/**
 * ダンスの核。拍・小節から身体のオフセットを決める純関数。
 * Three.js には依存しないので、ブラウザ無しでテストできる。
 *
 * base groove（bounce / sway / hip / head）に小節ごとの atom を重ねる。
 * 関節のローカル軸はモデル依存なので、腕の上げ下げだけ左右で符号を反転する。
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
  "Shoulder.L",
  "Shoulder.R",
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
  shoulder: number;
  knee: number;
  moves: DanceMove[];
};

const STYLES: Record<DanceStyle, StyleProfile> = {
  cute: {
    bounce: 0.85,
    sway: 1.2,
    hip: 1.35,
    arm: 0.8,
    head: 1.2,
    shoulder: 0.8,
    knee: 1.0,
    moves: ["stepTouch", "sway", "armWave", "pose"],
  },
  cool: {
    bounce: 0.55,
    sway: 0.65,
    hip: 0.7,
    arm: 1.1,
    head: 0.6,
    shoulder: 1.15,
    knee: 0.8,
    moves: ["bounce", "point", "sway", "pose"],
  },
  hype: {
    bounce: 1.4,
    sway: 0.9,
    hip: 0.9,
    arm: 1.35,
    head: 1.25,
    shoulder: 1.3,
    knee: 1.3,
    moves: ["bounce", "armWave", "stepTouch", "spin"],
  },
  chill: {
    bounce: 0.45,
    sway: 1.35,
    hip: 1.2,
    arm: 0.55,
    head: 0.85,
    shoulder: 0.6,
    knee: 0.7,
    moves: ["sway", "stepTouch", "pose", "sway"],
  },
};

const TAU = Math.PI * 2;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function smoothstep(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function easeInOut(value: number) {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function hit(phase: number, decay: number) {
  return Math.exp(-phase * decay);
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

const SIDES = ["L", "R"] as const;
type Side = (typeof SIDES)[number];

function sideSign(side: Side) {
  return side === "L" ? 1 : -1;
}

function upperArm(side: Side): DanceBone {
  return side === "L" ? "UpperArm.L" : "UpperArm.R";
}

function lowerArm(side: Side): DanceBone {
  return side === "L" ? "LowerArm.L" : "LowerArm.R";
}

function shoulder(side: Side): DanceBone {
  return side === "L" ? "Shoulder.L" : "Shoulder.R";
}

function upperLeg(side: Side): DanceBone {
  return side === "L" ? "UpperLeg.L" : "UpperLeg.R";
}

function lowerLeg(side: Side): DanceBone {
  return side === "L" ? "LowerLeg.L" : "LowerLeg.R";
}

/**
 * 1フレーム分のダンス姿勢を返す。
 * 呼び出し側は返り値をそのままルートとボーンに適用し、補間は適用側で行う。
 */
export function sampleDance(clock: DanceClock, cue: DanceCue): DancePose {
  const pose = emptyPose();
  if (!clock.playing) return pose;

  const profile = STYLES[cue.style] ?? STYLES.hype;
  const energy = clamp(finite(cue.energy, 0.7), 0.2, 1);
  const amp = 0.45 + 0.55 * energy;
  const phase = ((finite(clock.phase, 0) % 1) + 1) % 1;
  const beat = clamp(Math.floor(finite(clock.beat, 0)) % 4, 0, 3);
  const bar = Math.max(0, Math.floor(finite(clock.bar, 0)));
  const beatPos = beat + phase;
  const barPhase = beatPos / 4;
  const barSwing = Math.sin(barPhase * TAU);
  const down = Math.pow(0.5 + 0.5 * Math.cos(phase * TAU), 1.35); // 拍頭で1
  const up = 1 - down;
  const beatHit = hit(phase, 7);
  const accent = beatHit * (beat === 0 ? 1 : 0.55) * energy;
  const move =
    cue.moves.length > 0
      ? cue.moves[bar % cue.moves.length]
      : profile.moves[bar % profile.moves.length];

  // 重心。拍頭で沈み、拍の間に上がる。
  pose.rootY =
    (0.008 + 0.025 * energy) * profile.bounce * (0.25 + 0.75 * up) +
    (beat === 0 ? accent * 0.004 : 0);
  pose.rootX = barSwing * (0.025 + 0.055 * energy) * profile.sway;
  pose.rootYaw = barSwing * (0.035 + 0.07 * energy) * profile.hip;
  pose.rootRoll = -barSwing * (0.015 + 0.035 * energy) * profile.hip;
  pose.accent = accent;

  // 腰 → 胴 → 頭。胴は腰と逆にひねって、ただの左右揺れにしない。
  add(
    pose.bones,
    "Hips",
    down * 0.03 * amp,
    barSwing * 0.08 * profile.hip * amp,
    -barSwing * 0.035 * profile.hip * amp,
  );
  add(
    pose.bones,
    "Abdomen",
    -down * 0.02 * amp,
    -barSwing * 0.03 * profile.hip * amp,
    barSwing * 0.02 * profile.hip * amp,
  );
  add(
    pose.bones,
    "Torso",
    -down * 0.025 * amp,
    -barSwing * 0.05 * profile.hip * amp,
    barSwing * 0.025 * profile.hip * amp,
  );

  // 頭は Idle クリップに任せる。手続きで振ると首が抜けて見えるため。

  // 肩を上げて、腕の付け根から動かす。
  const shoulderLift = (0.02 + 0.055 * energy) * profile.shoulder * (0.35 + 0.65 * down);
  add(pose.bones, "Shoulder.L", 0, 0, shoulderLift);
  add(pose.bones, "Shoulder.R", 0, 0, -shoulderLift);

  // 腕。ローカルXは左が+、右が-で外側に上がる。ローカルZは前後スイング。
  const armSwing = Math.sin(barPhase * TAU + Math.PI / 2);
  for (const side of SIDES) {
    const s = sideSign(side);
    add(
      pose.bones,
      upperArm(side),
      s * (0.055 + 0.055 * energy) * profile.arm * amp,
      0,
      armSwing * (0.07 + 0.04 * energy) * profile.arm * amp,
    );
    add(
      pose.bones,
      lowerArm(side),
      0.14 * amp + Math.max(0, side === "L" ? armSwing : -armSwing) * 0.06 * profile.arm * amp,
      0,
      0,
    );
  }

  // 脚。膝は拍頭で曲げ、体重移動側を少し深くする。
  for (const side of SIDES) {
    const s = sideSign(side);
    const weight = side === "L" ? Math.max(0, barSwing) : Math.max(0, -barSwing);
    add(pose.bones, upperLeg(side), -0.02 * amp - weight * 0.025 * amp, 0, s * weight * 0.015 * amp);
    add(
      pose.bones,
      lowerLeg(side),
      (0.045 + 0.065 * energy) * profile.knee * (0.4 + 0.6 * down) + weight * 0.035 * amp,
      0,
      0,
    );
  }

  switch (move) {
    case "bounce": {
      // 膝と胸で拍を食う。腕は小さく突き上げる。
      for (const side of SIDES) {
        const s = sideSign(side);
        add(pose.bones, lowerLeg(side), down * 0.1 * amp, 0, 0);
        add(
          pose.bones,
          upperArm(side),
          s * down * 0.18 * profile.arm * amp,
          0,
          -s * down * 0.04 * profile.arm * amp,
        );
        add(pose.bones, lowerArm(side), down * 0.12 * amp, 0, 0);
      }
      add(pose.bones, "Torso", -down * 0.035 * amp, 0, 0);
      break;
    }
    case "sway": {
      // 左右の体重移動を大きく見せる。腕は振り子。
      const s = barSwing;
      pose.rootX += s * 0.07 * amp;
      add(pose.bones, "Hips", 0, s * 0.05 * amp, -s * 0.05 * profile.hip * amp);
      add(pose.bones, "Torso", 0, -s * 0.05 * amp, s * 0.04 * amp);
      add(pose.bones, "UpperArm.L", 0.18 * Math.max(0, s) * amp, 0, s * 0.1 * profile.arm * amp);
      add(pose.bones, "UpperArm.R", -0.18 * Math.max(0, -s) * amp, 0, s * 0.1 * profile.arm * amp);
      break;
    }
    case "stepTouch": {
      // 4拍で左ステップ → 右ステップ。踏んだ側の膝を伸ばす。
      const step = Math.sin(barPhase * TAU);
      const left = Math.max(0, step);
      const right = Math.max(0, -step);
      pose.rootX += step * 0.085 * amp;
      pose.rootYaw += step * 0.07 * amp;
      add(pose.bones, "Hips", 0, step * 0.04 * amp, -step * 0.035 * amp);
      add(pose.bones, "Torso", 0, -step * 0.035 * amp, step * 0.025 * amp);
      add(pose.bones, "UpperLeg.L", -left * 0.32 * amp, 0, 0);
      add(pose.bones, "LowerLeg.L", left * 0.4 * amp, 0, 0);
      add(pose.bones, "UpperLeg.R", -right * 0.32 * amp, 0, 0);
      add(pose.bones, "LowerLeg.R", right * 0.4 * amp, 0, 0);
      add(pose.bones, "UpperArm.L", left * 0.2 * amp, 0, -left * 0.12 * amp);
      add(pose.bones, "UpperArm.R", -right * 0.2 * amp, 0, right * 0.12 * amp);
      add(pose.bones, "LowerArm.L", left * 0.16 * amp, 0, 0);
      add(pose.bones, "LowerArm.R", right * 0.16 * amp, 0, 0);
      break;
    }
    case "armWave": {
      // 片腕ずつ上げる。肩 → 上腕 → 前腕の順に動かす。
      const wave = Math.sin(barPhase * TAU);
      const left = Math.max(0, wave);
      const right = Math.max(0, -wave);
      add(pose.bones, "Shoulder.L", 0, 0, left * 0.1 * profile.shoulder * amp);
      add(pose.bones, "Shoulder.R", 0, 0, -right * 0.1 * profile.shoulder * amp);
      add(pose.bones, "UpperArm.L", left * 1.15 * profile.arm * amp, 0, -left * 0.16 * amp);
      add(pose.bones, "UpperArm.R", -right * 1.15 * profile.arm * amp, 0, right * 0.16 * amp);
      add(pose.bones, "LowerArm.L", left * 0.38 * amp, 0, 0);
      add(pose.bones, "LowerArm.R", right * 0.38 * amp, 0, 0);
      add(pose.bones, "Torso", 0, (left - right) * 0.04 * amp, 0);
      break;
    }
    case "point": {
      // 小節ごとに指す腕を変える。上げて、少し保持して、戻す。
      const p = smoothstep(Math.sin(barPhase * Math.PI));
      const side: Side = bar % 2 === 0 ? "R" : "L";
      const s = sideSign(side);
      add(pose.bones, shoulder(side), 0, 0, s * p * 0.08 * profile.shoulder * amp);
      add(pose.bones, upperArm(side), s * p * 1.15 * profile.arm * amp, 0, -s * p * 0.22 * amp);
      add(pose.bones, lowerArm(side), p * 0.08 * amp, 0, 0);
      add(pose.bones, "Torso", 0, -s * p * 0.05 * amp, 0);
      break;
    }
    case "spin": {
      // 前半で1回転、後半は着地して次の小節へ。
      const spinPhase = clamp01(barPhase / 0.55);
      const spin = easeInOut(spinPhase);
      pose.rootYaw += spin * TAU;
      pose.rootY += Math.sin(spinPhase * Math.PI) * 0.02 * amp;
      add(pose.bones, "UpperArm.L", 0.32 * amp, 0, -0.25 * amp);
      add(pose.bones, "UpperArm.R", -0.32 * amp, 0, 0.25 * amp);
      add(pose.bones, "LowerArm.L", 0.35 * amp, 0, 0);
      add(pose.bones, "LowerArm.R", 0.35 * amp, 0, 0);
      add(pose.bones, "Torso", 0, 0.04 * amp, 0);
      break;
    }
    case "pose": {
      // 1拍目で決めて、少し保持する。左右でポーズを変える。
      const env = smoothstep(barPhase / 0.18) * smoothstep((1 - barPhase) / 0.18);
      const side: Side = bar % 2 === 0 ? "L" : "R";
      const s = sideSign(side);
      pose.rootX += s * 0.03 * env * amp;
      pose.rootY += 0.015 * env * amp;
      add(pose.bones, "Hips", 0, s * 0.06 * env * amp, 0);
      add(pose.bones, "Torso", 0, -s * 0.04 * env * amp, s * 0.02 * env * amp);
      add(pose.bones, upperArm(side), s * 0.95 * env * profile.arm * amp, 0, -s * 0.1 * env * amp);
      add(pose.bones, lowerArm(side), 0.18 * env * amp, 0, 0);
      add(pose.bones, upperArm(side === "L" ? "R" : "L"), -s * 0.3 * env * amp, 0, -s * 0.08 * env * amp);
      break;
    }
    case "headNod": {
      // 拍頭で首を落とし、次の拍まで戻す。
      const nod = hit(phase, 4.5) * (beat === 0 ? 1 : 0.65);
      add(pose.bones, "Neck", nod * 0.05 * amp, 0, 0);
      add(pose.bones, "Torso", nod * 0.03 * amp, 0, 0);
      add(pose.bones, "Shoulder.L", 0, 0, nod * 0.04 * amp);
      add(pose.bones, "Shoulder.R", 0, 0, -nod * 0.04 * amp);
      break;
    }
  }

  return pose;
}
