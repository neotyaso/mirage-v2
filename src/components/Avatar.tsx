import { useEffect, useRef, useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import * as THREE from "three";
import type { FaceCenter, FaceExpression } from "../hooks/useFaceDetection";

const MODEL_URL = "/avatar/sample.vrm";
const WALK_URL = "/avatar/walk.vrma";
const STRETCH_URL = "/avatar/stretch.vrma";
const GESTURE_FADE_S = 0.25;
const MAX_DELTA_S = 1 / 20;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ponytail: 互換のための残骸。Playgroundがimportしているので型と既定値だけ残す。中身は参照しない
export interface BeckonPose {
  armZ: number; armX: number; elbowZ: number; foreTwist: number;
  handRoll: number; sway: number; hz: number; shoulderZ: number;
}
export const DEFAULT_BECKON_POSE: BeckonPose = {
  armZ: -0.96, armX: 0.22, elbowZ: -0.66, foreTwist: 1.1, handRoll: -1.26, sway: 0.38, hz: 0.68, shoulderZ: 0.22,
};
export interface GlanceParams {
  durationS: number; intervalMinS: number; intervalMaxS: number;
  neckMax: number; lerp: number; pauseChance: number; chestMax: number;
}
export const DEFAULT_GLANCE_PARAMS: GlanceParams = {
  durationS: 0.8, intervalMinS: 3.5, intervalMaxS: 8.0, neckMax: 0.75, lerp: 0.22, pauseChance: 0.6, chestMax: 0.55,
};
export type WanderAnchorKey = "window" | "plant";
export interface AnchorGazeParams {
  chance: number; lingerMinS: number; lingerMaxS: number;
  neckMax: number; chestMax: number; turnLerp: number; pitch: number;
}
export const DEFAULT_ANCHOR_GAZE_PARAMS: AnchorGazeParams = {
  chance: 0.35, lingerMinS: 4, lingerMaxS: 7, neckMax: 0.5, chestMax: 0.45, turnLerp: 0.12, pitch: 0.12,
};

export interface AvatarProps {
  speakingRef?: RefObject<boolean>;
  volumeRef?: RefObject<number>;
  faceCenterRef?: RefObject<FaceCenter | null>;
  eyeCenterRef?: RefObject<FaceCenter | null>;
  allFaceCentersRef?: RefObject<FaceCenter[]>;
  allEyeCentersRef?: RefObject<FaceCenter[]>;
  expressionRef?: RefObject<FaceExpression>;
  faceSizeRef?: RefObject<number>;
  eyeDistanceRef?: RefObject<number>;
  actionRef?: RefObject<{ tag: "nod" | "tilt" | "surprise" | "stretch" | "beckon" | "glance"; id: number } | null>;
  paused?: boolean;
  conversing?: boolean;
  beckonPoseRef?: RefObject<BeckonPose>;
  glanceParamsRef?: RefObject<GlanceParams>;
  anchorGazeParamsRef?: RefObject<AnchorGazeParams>;
}

/**
 * VRMの器＋.vrma再生だけに畳んだAvatar。
 * 手書きの呼吸・瞬き・徘徊・手招き・視線の数式は撤去し、
 * 感情タグ→プリセット(.vrma)再生に寄せる(P8方針)。
 * まばたき・リップシンク・単純注視だけ残す(器を生かす最小限)。
 */
export function Avatar({ speakingRef, volumeRef, faceCenterRef, eyeCenterRef, actionRef, paused }: AvatarProps) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const blinkClock = useRef(0);
  const nextBlink = useRef(2 + Math.random() * 3);
  const mouth = useRef(0);
  const lookAtTarget = useRef(new THREE.Object3D());
  const walkMixer = useRef<THREE.AnimationMixer | null>(null);
  const walkAction = useRef<THREE.AnimationAction | null>(null);
  const gestureMixer = useRef<THREE.AnimationMixer | null>(null);
  const gestureAction = useRef<THREE.AnimationAction | null>(null);
  const gestureDuration = useRef(1);
  const gestureActive = useRef(false);
  const lastActionId = useRef(0);

  useEffect(() => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    let alive = true;
    loader.load(
      MODEL_URL,
      (gltf) => {
        const loaded = gltf.userData.vrm as VRM;
        if (loaded.meta?.metaVersion === "0") VRMUtils.rotateVRM0(loaded);
        loaded.scene.traverse((o) => (o.frustumCulled = false));
        if (loaded.lookAt) loaded.lookAt.target = lookAtTarget.current;
        const h = loaded.humanoid;
        const lArm = h?.getNormalizedBoneNode("leftUpperArm");
        const rArm = h?.getNormalizedBoneNode("rightUpperArm");
        if (lArm) { lArm.rotation.z = -1.2; lArm.rotation.x = 0.1; }
        if (rArm) { rArm.rotation.z = 1.2; rArm.rotation.x = 0.1; }
        if (alive) setVrm(loaded);
        else VRMUtils.deepDispose(loaded.scene);
      },
      undefined,
      (e) => console.error("VRM load error:", e)
    );
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!vrm) return;
    let alive = true;
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    loader.load(
      WALK_URL,
      (gltf) => {
        if (!alive) return;
        const vrmAnimation = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0];
        if (!vrmAnimation) return;
        const clip = createVRMAnimationClip(vrmAnimation, vrm);
        const mixer = new THREE.AnimationMixer(vrm.scene);
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
        action.setEffectiveWeight(0);
        walkMixer.current = mixer;
        walkAction.current = action;
      },
      undefined,
      (e) => console.error("walk VRMA load error:", e)
    );
    return () => { alive = false; };
  }, [vrm]);

  useEffect(() => {
    if (!vrm) return;
    let alive = true;
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    loader.load(
      STRETCH_URL,
      (gltf) => {
        if (!alive) return;
        const vrmAnimation = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0];
        if (!vrmAnimation) return;
        const clip = createVRMAnimationClip(vrmAnimation, vrm);
        const mixer = new THREE.AnimationMixer(vrm.scene);
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.setEffectiveWeight(0);
        gestureMixer.current = mixer;
        gestureAction.current = action;
        gestureDuration.current = clip.duration || 1;
      },
      undefined,
      (e) => console.error(`stretch VRMA load error:`, e)
    );
    return () => { alive = false; };
  }, [vrm]);

  useFrame((state, rawDelta) => {
    if (!vrm || paused) return;
    const delta = Math.min(rawDelta, MAX_DELTA_S);
    const t = state.clock.elapsedTime;

    if (!gestureActive.current) walkMixer.current?.update(delta);

    // 感情タグ→プリセット。stretch(.vrma)だけ再生し、手続き型(nod/tilt/beckon/glance/surprise)は無視
    const action = actionRef?.current;
    if (action && action.id !== lastActionId.current) {
      lastActionId.current = action.id;
      if (action.tag === "stretch" && gestureAction.current) {
        gestureAction.current.reset();
        gestureAction.current.setEffectiveWeight(0);
        gestureAction.current.play();
        gestureActive.current = true;
      }
    }

    if (gestureActive.current && gestureMixer.current && gestureAction.current) {
      gestureMixer.current.update(delta);
      const elapsed = gestureAction.current.time;
      const duration = gestureDuration.current;
      const fade = Math.min(GESTURE_FADE_S, duration / 4);
      let w = 1;
      if (elapsed < fade) w = elapsed / fade;
      else if (elapsed > duration - fade) w = Math.max(0, (duration - elapsed) / fade);
      gestureAction.current.setEffectiveWeight(w);
      if (elapsed >= duration - 0.001) gestureActive.current = false;
    }

    // 単純注視: 目の位置へ向けるだけ(スキャン・サッケード・首追従なし)
    const ec = eyeCenterRef?.current ?? faceCenterRef?.current ?? null;
    const targetX = ec ? lerp(-1.5, 1.5, 1 - ec.x) : 0;
    const targetY = ec ? lerp(2.5, 0.5, ec.y) : 1.5;
    lookAtTarget.current.position.x = lerp(lookAtTarget.current.position.x, targetX, 0.08);
    lookAtTarget.current.position.y = lerp(lookAtTarget.current.position.y, targetY, 0.08);
    lookAtTarget.current.position.z = 2;

    const em = vrm.expressionManager;
    if (em) {
      blinkClock.current += delta;
      const since = blinkClock.current - nextBlink.current;
      if (since >= 0) {
        const p = since / 0.12;
        if (p >= 1) {
          em.setValue("blink", 0);
          blinkClock.current = 0;
          nextBlink.current = 2 + Math.random() * 3;
        } else {
          em.setValue("blink", Math.sin(p * Math.PI));
        }
      }
      const speaking = speakingRef?.current ?? false;
      const vol = volumeRef?.current ?? 0;
      const target = speaking
        ? (vol > 0 ? clamp01(vol * 1.4) : clamp01(0.2 + 0.6 * Math.abs(Math.sin(t * 16))))
        : 0;
      mouth.current = lerp(mouth.current, target, 0.35);
      em.setValue("aa", mouth.current);
    }

    vrm.update(delta);
  });

  if (!vrm) return null;
  return <primitive object={vrm.scene} />;
}
