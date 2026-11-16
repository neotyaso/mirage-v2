import * as THREE from "three";

/**
 * PartLock-CMU の 22 関節（SMPL 順）を Mixamo のローカル回転に変換する。
 * 立ち姿（Idle）を基準に、フレーム0との差分だけを Mixamo の骨へ写す。
 */

const PELVIS = 0, L_HIP = 1, R_HIP = 2, SPINE1 = 3, L_KNEE = 4, R_KNEE = 5, SPINE2 = 6;
const L_ANKLE = 7, R_ANKLE = 8, SPINE3 = 9, L_FOOT = 10, R_FOOT = 11, NECK = 12;
const L_COLLAR = 13, R_COLLAR = 14, HEAD = 15, L_SHOULDER = 16, R_SHOULDER = 17;
const L_ELBOW = 18, R_ELBOW = 19, L_WRIST = 20, R_WRIST = 21;

const BONES = {
  hips: "mixamorigHips",
  spine: "mixamorigSpine",
  chest: "mixamorigSpine1",
  upperChest: "mixamorigSpine2",
  neck: "mixamorigNeck",
  leftShoulder: "mixamorigLeftShoulder",
  leftArm: "mixamorigLeftArm",
  leftForeArm: "mixamorigLeftForeArm",
  rightShoulder: "mixamorigRightShoulder",
  rightArm: "mixamorigRightArm",
  rightForeArm: "mixamorigRightForeArm",
  leftUpLeg: "mixamorigLeftUpLeg",
  leftLeg: "mixamorigLeftLeg",
  leftFoot: "mixamorigLeftFoot",
  rightUpLeg: "mixamorigRightUpLeg",
  rightLeg: "mixamorigRightLeg",
  rightFoot: "mixamorigRightFoot",
} as const;

const STAND_BONES = {
  ...BONES,
  head: "mixamorigHead",
  leftHand: "mixamorigLeftHand",
  rightHand: "mixamorigRightHand",
  leftToe: "mixamorigLeftToeBase",
  rightToe: "mixamorigRightToeBase",
} as const;

type BoneKey = keyof typeof BONES;

const WORLD_PARENT: Record<string, string | null> = {
  hips: null,
  spine: "hips",
  chest: "spine",
  upperChest: "chest",
  neck: "upperChest",
  leftShoulder: "upperChest",
  leftArm: "leftShoulder",
  leftForeArm: "leftArm",
  rightShoulder: "upperChest",
  rightArm: "rightShoulder",
  rightForeArm: "rightArm",
  leftUpLeg: "hips",
  leftLeg: "leftUpLeg",
  leftFoot: "leftLeg",
  rightUpLeg: "hips",
  rightLeg: "rightUpLeg",
  rightFoot: "rightLeg",
};

const WORLD_ORDER = [
  "hips", "spine", "chest", "upperChest", "neck",
  "leftShoulder", "leftArm", "leftForeArm",
  "rightShoulder", "rightArm", "rightForeArm",
  "leftUpLeg", "leftLeg", "leftFoot",
  "rightUpLeg", "rightLeg", "rightFoot",
];

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export type RetargetRest = {
  rest: Record<string, THREE.Vector3>;
  standWorld: Record<string, THREE.Quaternion>;
  hipsParentWorld: THREE.Quaternion;
};

const getNode = (model: THREE.Object3D, name: string) => model.getObjectByName(name);

/** Idle を再生した状態で呼ぶ。Mixamo の立ち姿を rest として記録する。 */
export function captureRetargetRest(model: THREE.Object3D): RetargetRest {
  const positions: Record<string, THREE.Vector3> = {};
  const standWorld: Record<string, THREE.Quaternion> = {};
  for (const [key, name] of Object.entries(STAND_BONES)) {
    const node = getNode(model, name);
    if (!node) continue;
    positions[key] = node.getWorldPosition(new THREE.Vector3());
    if (key in BONES) standWorld[key] = node.getWorldQuaternion(new THREE.Quaternion());
  }

  const rest: Record<string, THREE.Vector3> = {
    spine: positions.spine.clone().sub(positions.chest),
    chest: positions.upperChest.clone().sub(positions.chest),
    neck: positions.head.clone().sub(positions.neck),
    leftShoulder: positions.leftArm.clone().sub(positions.leftShoulder),
    leftArm: positions.leftForeArm.clone().sub(positions.leftArm),
    leftForeArm: positions.leftHand.clone().sub(positions.leftForeArm),
    rightShoulder: positions.rightArm.clone().sub(positions.rightShoulder),
    rightArm: positions.rightForeArm.clone().sub(positions.rightArm),
    rightForeArm: positions.rightHand.clone().sub(positions.rightForeArm),
    leftUpLeg: positions.leftLeg.clone().sub(positions.leftUpLeg),
    leftLeg: positions.leftFoot.clone().sub(positions.leftLeg),
    leftFoot: positions.leftToe.clone().sub(positions.leftFoot),
    rightUpLeg: positions.rightLeg.clone().sub(positions.rightUpLeg),
    rightLeg: positions.rightFoot.clone().sub(positions.rightLeg),
    rightFoot: positions.rightToe.clone().sub(positions.rightFoot),
  };

  const hips = getNode(model, BONES.hips);
  const hipsParentWorld = hips?.parent
    ? hips.parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();

  return { rest, standWorld, hipsParentWorld };
}

const swing = (u: THREE.Vector3, v: THREE.Vector3, fallback: THREE.Vector3) => {
  const a = u.clone().normalize();
  const b = v.clone().normalize();
  const w = 1 + a.dot(b);
  if (w < 1e-6) return new THREE.Quaternion().setFromAxisAngle(fallback.clone().normalize(), Math.PI);
  const c = new THREE.Vector3().crossVectors(a, b);
  return new THREE.Quaternion(c.x, c.y, c.z, w).normalize();
};

const frame = (across: THREE.Vector3, up: THREE.Vector3) => {
  const a = across.clone().normalize();
  const first = swing(X, a, Z);
  const upOrtho = up.clone().sub(a.clone().multiplyScalar(up.dot(a))).normalize();
  const rotatedY = Y.clone().applyQuaternion(first);
  return swing(rotatedY, upOrtho, a).multiply(first);
};

const joint = (joints: number[][], index: number) =>
  new THREE.Vector3(joints[index][0], joints[index][1], joints[index][2]);

function retargetWorld(joints: number[][], rest: RetargetRest) {
  const world: Record<string, THREE.Quaternion> = {};
  const limb = (bone: string, parent: string, start: number, end: number) => {
    const parentWorld = world[parent];
    const carried = rest.rest[bone].clone().applyQuaternion(parentWorld);
    const fallback = Z.clone().applyQuaternion(parentWorld);
    world[bone] = swing(carried, joint(joints, end).sub(joint(joints, start)), fallback).multiply(parentWorld);
  };

  world.hips = frame(joint(joints, L_HIP).sub(joint(joints, R_HIP)), joint(joints, SPINE1).sub(joint(joints, PELVIS)));
  limb("spine", "hips", SPINE1, SPINE2);
  limb("chest", "spine", SPINE2, SPINE3);
  world.upperChest = frame(joint(joints, L_COLLAR).sub(joint(joints, R_COLLAR)), joint(joints, NECK).sub(joint(joints, SPINE3)));
  limb("neck", "upperChest", NECK, HEAD);
  limb("leftShoulder", "upperChest", L_COLLAR, L_SHOULDER);
  limb("leftArm", "leftShoulder", L_SHOULDER, L_ELBOW);
  limb("leftForeArm", "leftArm", L_ELBOW, L_WRIST);
  limb("rightShoulder", "upperChest", R_COLLAR, R_SHOULDER);
  limb("rightArm", "rightShoulder", R_SHOULDER, R_ELBOW);
  limb("rightForeArm", "rightArm", R_ELBOW, R_WRIST);
  limb("leftUpLeg", "hips", L_HIP, L_KNEE);
  limb("leftLeg", "leftUpLeg", L_KNEE, L_ANKLE);
  limb("leftFoot", "leftLeg", L_ANKLE, L_FOOT);
  limb("rightUpLeg", "hips", R_HIP, R_KNEE);
  limb("rightLeg", "rightUpLeg", R_KNEE, R_ANKLE);
  limb("rightFoot", "rightLeg", R_ANKLE, R_FOOT);
  return world;
}

function retargetLocal(world: Record<string, THREE.Quaternion>, base: Record<string, THREE.Quaternion>, rest: RetargetRest) {
  const desired: Record<string, THREE.Quaternion> = {};
  const local: Record<string, THREE.Quaternion> = {};
  for (const bone of WORLD_ORDER) {
    const delta = world[bone].clone().multiply(base[bone].clone().invert());
    desired[bone] = delta.multiply(rest.standWorld[bone]);
    const parent = WORLD_PARENT[bone];
    const parentWorld = parent ? desired[parent] : rest.hipsParentWorld;
    local[bone] = parentWorld.clone().invert().multiply(desired[bone]);
  }
  return local;
}

/** joints: (フレーム, 22, 3)。30fps の AnimationClip を返す。 */
export function toGeneratedClip(name: string, joints: number[][][], rest: RetargetRest, fps = 30): THREE.AnimationClip {
  if (joints.length === 0) throw new Error("generated motion has no frames");
  const base = retargetWorld(joints[0], rest);
  const times: number[] = [];
  const values: Record<string, number[]> = {};
  for (let i = 0; i < joints.length; i++) {
    times.push(i / fps);
    const local = retargetLocal(retargetWorld(joints[i], rest), base, rest);
    for (const [bone, q] of Object.entries(local)) {
      (values[bone] ??= []).push(q.x, q.y, q.z, q.w);
    }
  }
  const tracks = Object.entries(values).map(([bone, data]) => {
    const node = BONES[bone as BoneKey];
    return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, data);
  });
  return new THREE.AnimationClip(name, (joints.length - 1) / fps, tracks);
}
