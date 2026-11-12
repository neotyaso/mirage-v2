import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { DanceStyle } from "./dance";

const DIR = "/models/mixamo";

/**
 * Mixamo のモーションは 30fps のモーションキャプチャで、曲のテンポとは独立している。
 * bpm は「このクリップが本来持っている拍」の目安。再生速度だけを曲に合わせる。
 */
export const MIXAMO_CLIPS = [
  { id: "Idle", file: "Idle" },
  { id: "Walking", file: "Walking" },
  // firstBeat は「クリップ先頭から1拍目まで」の秒数。Mixamo は先頭が拍頭の前提。
  // 拍がズレるクリップだけここを調整する。
  { id: "Robot_Hip_Hop_Dance", file: "Robot_Hip_Hop_Dance", bpm: 100, firstBeat: 0 },
  { id: "Breakdance_Uprock", file: "Breakdance_Uprock", bpm: 110, firstBeat: 0 },
  { id: "Jazz_Dancing", file: "Jazz_Dancing", bpm: 128, firstBeat: 0 },
  { id: "House_Dancing", file: "House_Dancing", bpm: 110, firstBeat: 0 },
] as const;

type ClipDef = (typeof MIXAMO_CLIPS)[number];
export type MixamoClipId = ClipDef["id"];

const STYLE_CLIP: Record<DanceStyle, MixamoClipId> = {
  hype: "Robot_Hip_Hop_Dance",
  cool: "Breakdance_Uprock",
  cute: "Jazz_Dancing",
  chill: "House_Dancing",
};

export function clipForStyle(style: DanceStyle): MixamoClipId {
  return STYLE_CLIP[style] ?? "Robot_Hip_Hop_Dance";
}

function bpmFor(id: string): number | null {
  const def = MIXAMO_CLIPS.find((clip) => clip.id === id);
  return def && "bpm" in def ? def.bpm : null;
}

/** 横方向のルートモーションだけ殺して、ステージ中央で踊らせる。上下は残す。 */
function makeInPlace(clip: THREE.AnimationClip, name: string) {
  clip.name = name;
  for (const track of clip.tracks) {
    if (!/Hips\.position$/.test(track.name)) continue;
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = 0;
      track.values[i + 2] = 0;
    }
  }
}

/** SkinnedMesh は Box3.setFromObject だとバインドポーズを拾うので、今のポーズで測る。 */
function measure(model: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  model.updateMatrixWorld(true);
  model.traverse((obj) => {
    if (!(obj instanceof THREE.SkinnedMesh)) return;
    obj.computeBoundingBox();
    if (obj.boundingBox) box.union(obj.boundingBox.clone().applyMatrix4(obj.matrixWorld));
  });
  return box;
}

/**
 * Michelle.glb は Blender 書き出しの Character ルートに +90° X と 0.01 スケールが残っている。
 * 親で回転を打ち消し、Idle の立ち姿で 1.72m に正規化して足を床に合わせる。
 */
export function normalizeMixamoModel(
  model: THREE.Object3D,
  mixer: THREE.AnimationMixer,
  idle: THREE.AnimationAction,
  targetHeight = 1.72,
) {
  model.rotation.x = -Math.PI / 2;
  idle.reset().play();
  idle.time = 0.5;
  mixer.update(0);

  const box = measure(model);
  const height = Math.max(box.max.y - box.min.y, 0.001);
  model.scale.multiplyScalar(targetHeight / height);

  const grounded = measure(model);
  model.position.y -= grounded.min.y;

  const hips = model.getObjectByName("mixamorigHips");
  if (hips) {
    const p = new THREE.Vector3();
    hips.getWorldPosition(p);
    model.position.x -= p.x;
    model.position.z -= p.z;
  }
  model.updateMatrixWorld(true);
  idle.stop();
}

export type MixamoRig = {
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
};

export async function loadMixamoRig(loader: GLTFLoader): Promise<MixamoRig> {
  const gltf = await loader.loadAsync(`${DIR}/Michelle.glb`);
  const model = gltf.scene;
  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      // 布と肌がスポットライトで鏡面発光してブルームに飛ぶのを抑える。
      material.metalness = Math.min(material.metalness, 0.02);
      material.roughness = Math.max(material.roughness, 0.82);
    }
  });

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();
  const add = (clip: THREE.AnimationClip, name: string) => {
    makeInPlace(clip, name);
    actions.set(name, mixer.clipAction(clip));
  };

  for (const clip of gltf.animations) add(clip, clip.name);

  const external = await Promise.all(
    MIXAMO_CLIPS.map(async (def) => ({ def, gltf: await loader.loadAsync(`${DIR}/${def.file}.glb`) })),
  );
  for (const { def, gltf: clipGltf } of external) {
    for (const clip of clipGltf.animations) add(clip, def.id);
  }

  const idle = actions.get("Idle");
  if (idle) normalizeMixamoModel(model, mixer, idle);

  return { model, mixer, actions };
}

export function timeScaleForClip(id: string, bpm: number): number {
  const natural = bpmFor(id);
  if (!natural) return 1;
  return THREE.MathUtils.clamp(bpm / natural, 0.8, 1.25);
}

/** 小節頭でクリップを開始するときの、クリップ内の開始秒。 */
export function clipStartOffset(id: string): number {
  const def = MIXAMO_CLIPS.find((clip) => clip.id === id);
  return def && "firstBeat" in def ? def.firstBeat : 0;
}
