import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { FunctionCall } from "@google/genai";
import { useGeminiLive } from "../hooks/useGeminiLive";
import { DanceAudio } from "./audio";
import {
  defaultMoves,
  isDanceMove,
  isDanceStyle,
  mergeDanceCue,
  sampleDance,
  type DanceBone,
  type DanceCue,
  type DanceMove,
  type DancePose,
  type DanceStyle,
} from "./dance";
import { DJ_SYSTEM_PROMPT, DJ_TOOLS, buildMcPrompt } from "./mc";
import {
  MARKS,
  TRACKS,
  nextTrack,
  type MarkId,
  type ShowAction,
  type ShowMode,
  type ShowState,
  type TrackId,
} from "./show";
import "./dance.css";

const PLATFORM_TOP = 0.14;
const BASE_BPM = TRACKS.neon.bpm;

// GLTFLoader はノード名を sanitize する（UpperArm.L -> UpperArmL、重複 -> _1）。
// ダンス側は読みやすい名前のまま、実ボーンへの対応だけここで持つ。
const BONE_ALIASES: Record<string, DanceBone> = {
  Hips: "Hips",
  Abdomen: "Abdomen",
  Torso: "Torso",
  Neck: "Neck",
  Head: "Head",
  UpperArmL: "UpperArm.L",
  LowerArmL: "LowerArm.L",
  UpperArmR: "UpperArm.R",
  LowerArmR: "LowerArm.R",
  UpperLegL: "UpperLeg.L",
  LowerLegL: "LowerLeg.L",
  UpperLegR: "UpperLeg.R",
  LowerLegR: "LowerLeg.R",
};

type StageApi = {
  start: () => void;
  setClip: (clip: string, bpm: number) => void;
  setMuted: (muted: boolean) => void;
  setDucked: (ducked: boolean) => void;
  stopMusic: (fadeBars?: number) => void;
  playTrack: (trackId: TrackId) => void;
  walkTo: (mark: MarkId) => void;
  talk: () => void;
  dance: (input: { bpm?: number; energy?: number; style?: DanceStyle; moves?: DanceMove[] }) => void;
  gesture: (intent: string) => void;
  getState: () => ShowState;
};

type Request = { clip: string; label: string; bpm: number };

const CLIPS: Array<[RegExp, string, string]> = [
  [/手を振|バイバイ|wave/i, "Wave", "WAVE"],
  [/ジャンプ|跳|jump/i, "Jump", "JUMP"],
  [/決め|キメ|ポーズ|かっこ|thumbs/i, "ThumbsUp", "POSE"],
  [/歩|walk/i, "Walking", "WALK"],
  [/走|run/i, "Running", "RUN"],
  [/うなず|yes/i, "Yes", "NOD"],
  [/パンチ|punch/i, "Punch", "PUNCH"],
  [/座|sit/i, "Sitting", "SIT"],
  [/立て|stand/i, "Standing", "STAND"],
  [/踊|dance/i, "Dance", "DANCE"],
];

const QUICK: Array<{ label: string; prompt: string }> = [
  { label: "踊って", prompt: "元気に踊って" },
  { label: "止めて", prompt: "音楽を止めて" },
  { label: "歩いて", prompt: "歩いて" },
  { label: "話して", prompt: "話して" },
  { label: "次の曲", prompt: "次の曲" },
  { label: "手を振って", prompt: "手を振って" },
];

function parseBpm(text: string, currentBpm: number): number {
  if (/ゆっくり|静か|スロー|slow|chill/i.test(text)) return 88;
  if (/元気|アゲ|上げ|速|激|party|fast|up/i.test(text)) return 132;
  if (/かわい|キュート|cute/i.test(text)) return 120;
  return currentBpm;
}

function parseRequest(text: string, currentBpm: number): Request {
  const bpm = parseBpm(text, currentBpm);
  const hit = CLIPS.find(([pattern]) => pattern.test(text));
  if (hit) return { clip: hit[1], label: hit[2], bpm };
  return { clip: "Dance", label: "DANCE", bpm };
}

function parseDanceStyle(text: string): DanceStyle {
  if (/かわい|キュート|cute/i.test(text)) return "cute";
  if (/かっこ|クール|cool/i.test(text)) return "cool";
  if (/ゆっくり|静か|スロー|chill|lo-?fi/i.test(text)) return "chill";
  return "hype";
}

const GESTURES = ["wave", "nod", "point", "celebrate"] as const;
type GestureIntent = (typeof GESTURES)[number];

function asMark(value: unknown): MarkId {
  return value === "left" || value === "right" || value === "front" ? value : "center";
}

function cleanMc(text: string): string {
  return text
    .replace(/<no speech[^>]*>/gi, "")
    .replace(/\{pause\}/gi, "")
    .replace(/<[^>]*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function DanceStage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<StageApi | null>(null);
  const startedRef = useRef(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [clipLabel, setClipLabel] = useState("IDLE");
  const [mcLine, setMcLine] = useState("");
  const [mcError, setMcError] = useState<string | null>(null);
  const [show, setShow] = useState<ShowState>({
    mode: "idle",
    trackId: "neon",
    trackName: TRACKS.neon.name,
    bpm: BASE_BPM,
    playing: false,
    bar: 0,
    beat: 0,
    style: "hype",
    energy: 0.7,
  });
  const showRef = useRef(show);
  showRef.current = show;
  const modeCallbackRef = useRef<(mode: ShowMode) => void>(() => {});
  modeCallbackRef.current = (mode) => {
    setShow((prev) => (prev.mode === mode ? prev : { ...prev, mode }));
    setClipLabel(mode === "dance" ? "DANCE" : mode === "walk" ? "WALK" : mode === "talk" ? "TALK" : "IDLE");
  };

  const applyAction = useCallback((action: ShowAction) => {
    const api = apiRef.current;
    if (!api) return;
    switch (action.type) {
      case "dance":
        api.dance({
          bpm: action.bpm,
          energy: action.energy,
          style: action.style,
          moves: action.moves,
        });
        api.setDucked(false);
        setClipLabel("DANCE");
        setShow((s) => ({
          ...s,
          mode: "dance",
          playing: true,
          bpm: action.bpm ?? s.bpm,
          style: action.style ?? s.style,
          energy: action.energy ?? s.energy,
        }));
        break;
      case "stopMusic":
        api.stopMusic(action.fadeBars);
        setClipLabel("IDLE");
        setShow((s) => ({ ...s, mode: "idle", playing: false }));
        break;
      case "playTrack":
        api.playTrack(action.trackId);
        setClipLabel("DANCE");
        setShow((s) => ({
          ...s,
          mode: "dance",
          playing: true,
          trackId: action.trackId,
          trackName: TRACKS[action.trackId].name,
          bpm: TRACKS[action.trackId].bpm,
        }));
        break;
      case "walkTo":
        api.walkTo(action.mark);
        setClipLabel("WALK");
        setShow((s) => ({ ...s, mode: "walk" }));
        break;
      case "talk":
        api.talk();
        setClipLabel("TALK");
        setShow((s) => ({ ...s, mode: "talk" }));
        break;
      case "gesture":
        api.gesture(action.intent);
        setClipLabel(action.intent.toUpperCase());
        break;
      case "setClip":
        api.setClip(action.clip, showRef.current.bpm);
        setClipLabel(action.clip.toUpperCase());
        break;
    }
  }, []);

  const handleMcTool = useCallback(
    async (call: FunctionCall) => {
      const args = call.args ?? {};
      switch (call.name) {
        case "dance": {
          const moves = Array.isArray(args.moves)
            ? args.moves.filter(isDanceMove).slice(0, 8)
            : undefined;
          applyAction({
            type: "dance",
            bpm: typeof args.bpm === "number" ? args.bpm : undefined,
            energy: typeof args.energy === "number" ? args.energy : undefined,
            style: isDanceStyle(args.style) ? args.style : undefined,
            moves,
          });
          break;
        }
        case "stop_music":
          applyAction({
            type: "stopMusic",
            fadeBars: typeof args.fadeBars === "number" ? args.fadeBars : 1,
          });
          break;
        case "play_track":
          applyAction({
            type: "playTrack",
            trackId: args.trackId === "pulse" ? "pulse" : "neon",
          });
          break;
        case "walk":
          applyAction({ type: "walkTo", mark: asMark(args.mark) });
          break;
        case "talk":
          applyAction({ type: "talk" });
          break;
        case "gesture": {
          const raw = String(args.intent ?? "wave");
          const intent = (GESTURES as readonly string[]).includes(raw) ? (raw as GestureIntent) : "wave";
          applyAction({ type: "gesture", intent });
          break;
        }
        default:
          return { error: `unknown tool: ${call.name}` };
      }
      return { output: "ok" };
    },
    [applyAction],
  );

  const gemini = useGeminiLive({
    capture: false,
    systemPrompt: DJ_SYSTEM_PROMPT,
    tools: DJ_TOOLS,
    onToolCall: handleMcTool,
    onOutputText: (text) => {
      if (!text.trim()) return;
      setMcLine((prev) => (prev + text).slice(-180));
    },
    onError: (e) => setMcError(e.message),
  });

  const askMc = useCallback(
    (text: string) => {
      setMcLine("");
      gemini.prompt(text);
    },
    [gemini.prompt],
  );

  useEffect(() => {
    apiRef.current?.setDucked(gemini.state === "speaking" || show.mode === "talk");
  }, [gemini.state, show.mode]);

  useEffect(() => {
    if (show.mode !== "talk" || gemini.state !== "listening") return;
    const timer = window.setTimeout(() => {
      if (showRef.current.mode === "talk") applyAction({ type: "dance" });
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [show.mode, gemini.state, applyAction]);

  const lastBarRef = useRef(-1);
  useEffect(() => {
    if (!started) return;
    const timer = window.setInterval(() => {
      const state = apiRef.current?.getState();
      if (!state) return;
      setShow((prev) => {
        const same =
          prev.mode === state.mode &&
          prev.trackId === state.trackId &&
          prev.playing === state.playing &&
          prev.bar === state.bar &&
          prev.beat === state.beat &&
          prev.bpm === state.bpm &&
          prev.style === state.style &&
          prev.energy === state.energy;
        return same ? prev : { ...prev, ...state };
      });
      if (!state.playing) return;
      if (state.bar > 0 && state.bar % 8 === 0 && state.bar !== lastBarRef.current) {
        lastBarRef.current = state.bar;
        if (gemini.state === "listening") askMc(buildMcPrompt(state));
      }
    }, 350);
    return () => window.clearInterval(timer);
  }, [started, gemini.state, askMc]);

  const openingSentRef = useRef(false);
  useEffect(() => {
    if (!started || openingSentRef.current || gemini.state !== "listening") return;
    openingSentRef.current = true;
    askMc(
      `${buildMcPrompt(showRef.current, true)}\nショーが始まった。観客に短く挨拶して、dance ツールで踊りを開始して。`,
    );
  }, [started, gemini.state, askMc]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04050a);
    scene.fog = new THREE.FogExp2(0x04050a, 0.04);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.18;

    // 床とグリッド
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7, 64),
      new THREE.MeshStandardMaterial({ color: 0x070911, metalness: 0.9, roughness: 0.32 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(24, 48, 0x1a3350, 0x0c1728);
    grid.position.y = 0.002;
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.45;
    scene.add(grid);

    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x0b1020,
      metalness: 0.8,
      roughness: 0.26,
      emissive: new THREE.Color(0x0a2740),
      emissiveIntensity: 0.35,
    });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.25, PLATFORM_TOP, 64), platformMat);
    platform.position.y = PLATFORM_TOP / 2;
    platform.castShadow = true;
    platform.receiveShadow = true;
    scene.add(platform);

    const ringMat = new THREE.MeshBasicMaterial({ color: 0x5ee7ff, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.06, 2.14, 96), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = PLATFORM_TOP + 0.003;
    scene.add(ring);

    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 0.8, 64),
      new THREE.MeshBasicMaterial({ color: 0xff5fb2, toneMapped: false, transparent: true, opacity: 0.6 }),
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = PLATFORM_TOP + 0.004;
    scene.add(innerRing);

    // 奥のLEDスクリーン
    const screenCanvas = document.createElement("canvas");
    screenCanvas.width = 1024;
    screenCanvas.height = 512;
    const g = screenCanvas.getContext("2d")!;
    g.fillStyle = "#040711";
    g.fillRect(0, 0, 1024, 512);
    g.strokeStyle = "rgba(94,231,255,0.10)";
    g.lineWidth = 1;
    for (let x = 0; x <= 1024; x += 64) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 512);
      g.stroke();
    }
    for (let y = 0; y <= 512; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(1024, y);
      g.stroke();
    }
    g.textAlign = "center";
    g.fillStyle = "#5ee7ff";
    g.font = "700 150px Helvetica, Arial, sans-serif";
    g.fillText("MIRAGE", 512, 245);
    g.fillStyle = "#ff5fb2";
    g.font = "500 34px monospace";
    g.fillText("A I   D J   /   3 D   S T A G E", 512, 320);
    const screenTexture = new THREE.CanvasTexture(screenCanvas);
    screenTexture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(5.8, 2.9),
      new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false, transparent: true, opacity: 0.85 }),
    );
    screen.position.set(0, 2.2, -3.8);
    scene.add(screen);

    for (const [x, color] of [
      [-3.4, 0xff5fb2],
      [3.4, 0x5ee7ff],
    ] as const) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 3.4, 0.035),
        new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      );
      bar.position.set(x, 1.7, -2.2);
      scene.add(bar);
    }

    // 空中の粒子
    const count = 240;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.6 + Math.random() * 4;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.random() * 4.8;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(
      particleGeo,
      new THREE.PointsMaterial({
        color: 0x8be8ff,
        size: 0.025,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    scene.add(particles);

    // ライト
    scene.add(new THREE.HemisphereLight(0x9fc6ff, 0x05060a, 0.4));
    const key = new THREE.DirectionalLight(0xdfe8ff, 1.1);
    key.position.set(2.5, 5.5, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 14;
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -1;
    scene.add(key);

    const spotA = new THREE.SpotLight(0x5ee7ff, 100, 20, 0.6, 0.9, 2);
    spotA.position.set(3.2, 5.4, 1.6);
    spotA.target.position.set(0, 1, 0);
    scene.add(spotA, spotA.target);

    const spotB = new THREE.SpotLight(0xff5fb2, 80, 20, 0.55, 1, 2);
    spotB.position.set(-3.2, 4.6, -1.2);
    spotB.target.position.set(0, 1, 0);
    scene.add(spotB, spotB.target);

    // 接地影
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sg = shadowCanvas.getContext("2d")!;
    const grad = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, "rgba(0,0,0,0.75)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.28)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 128, 128);
    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(shadowCanvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = PLATFORM_TOP + 0.006;
    scene.add(contactShadow);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.5, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const audio = new DanceAudio();
    let pulse = 0;
    audio.onBeat = () => {
      pulse = 1;
    };

    const robotRoot = new THREE.Group();
    robotRoot.position.y = PLATFORM_TOP;
    scene.add(robotRoot);

    let mixer: THREE.AnimationMixer | null = null;
    const actions = new Map<string, THREE.AnimationAction>();
    let current: THREE.AnimationAction | null = null;
    let baseClip = "Idle";
    let desiredClip = "Idle";
    let mode: ShowMode = "idle";
    let danceCue: DanceCue = { style: "hype", energy: 0.7, moves: [] };
    let walkTarget: THREE.Vector3 | null = null;
    let disposed = false;
    let startedAt = -1;
    let baseRadius = 4.6;
    let stageX = 0;
    let stageZ = 0;
    let baseYaw = 0;
    let dancePose: DancePose | null = null;
    let smoothYaw = 0;
    let smoothRootX = 0;
    let smoothRootY = 0;
    let smoothRootRoll = 0;
    const rigBones = new Map<string, THREE.Bone>();
    const restQuats = new Map<string, THREE.Quaternion>();
    const animatedTracks = new Map<THREE.AnimationAction, Set<string>>();
    const poseEuler = new THREE.Euler();
    const poseQuat = new THREE.Quaternion();
    const baseQuat = new THREE.Quaternion();

    const setMode = (next: ShowMode) => {
      if (mode === next) return;
      mode = next;
      modeCallbackRef.current(next);
    };

    const oneShot = new Set(["Jump", "ThumbsUp", "Wave", "Yes", "No", "Punch", "Death", "WalkJump"]);

    const fadeTo = (name: string) => {
      const next = actions.get(name) ?? actions.get("Idle");
      if (!next) return;
      if (next === current) {
        // 同じループクリップを dance ツールのたびに頭へ戻さない。one-shot だけ再生し直す。
        if (oneShot.has(name)) next.reset().play();
        else next.play();
        return;
      }
      next.reset();
      next.enabled = true;
      next.setEffectiveWeight(1);
      next.setLoop(oneShot.has(name) ? THREE.LoopOnce : THREE.LoopRepeat, oneShot.has(name) ? 1 : Infinity);
      next.clampWhenFinished = oneShot.has(name);
      next.play();
      if (current) current.crossFadeTo(next, 0.32, false);
      else next.fadeIn(0.3);
      current = next;
    };

    // 曲のBPMに身体の再生速度を合わせる。振付の土台はここ。
    const syncSpeed = () => {
      const base = actions.get(baseClip);
      if (!base) return;
      base.timeScale = Math.max(0.65, Math.min(1.5, audio.bpm / BASE_BPM));
    };

    const trackBones = (action: THREE.AnimationAction) => {
      let set = animatedTracks.get(action);
      if (!set) {
        set = new Set<string>();
        for (const track of action.getClip().tracks) {
          const dot = track.name.lastIndexOf(".");
          set.add(dot > 0 ? track.name.slice(0, dot) : track.name);
        }
        animatedTracks.set(action, set);
      }
      return set;
    };

    // mixer.update() の後ろにローカル回転を足す。アニメーションが書かない骨は
    // rest を基準にするので、フレームをまたいで回転が累積しない。
    const applyRigPose = (pose: DancePose | null) => {
      const animated = new Set<string>();
      for (const action of actions.values()) {
        if (!action.isRunning()) continue;
        for (const name of trackBones(action)) animated.add(name);
      }
      for (const [name, bone] of rigBones) {
        if (animated.has(bone.name)) baseQuat.copy(bone.quaternion);
        else {
          const rest = restQuats.get(name);
          if (!rest) continue;
          baseQuat.copy(rest);
        }
        const offset = pose?.bones[name as DanceBone];
        if (offset && (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0)) {
          poseEuler.set(offset[0], offset[1], offset[2]);
          poseQuat.setFromEuler(poseEuler);
          bone.quaternion.copy(baseQuat).multiply(poseQuat);
        } else {
          bone.quaternion.copy(baseQuat);
        }
      }
    };

    const smooth = (value: number, target: number, dt: number, rate = 14) =>
      value + (target - value) * (1 - Math.exp(-rate * dt));
    const smoothAngle = (value: number, target: number, dt: number, rate = 10) => {
      const delta = Math.atan2(Math.sin(target - value), Math.cos(target - value));
      return value + delta * (1 - Math.exp(-rate * dt));
    };

    // RobotExpressive.glb: Tomás Laulhé / Don McCurdy, CC0 1.0 (Three.js examples)
    const loader = new GLTFLoader();
    loader.load("/models/RobotExpressive.glb", (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      model.traverse((obj) => {
        if (obj instanceof THREE.Bone) {
          const semantic = BONE_ALIASES[obj.name.replace(/_\d+$/, "")];
          if (semantic && !rigBones.has(semantic)) {
            rigBones.set(semantic, obj);
            restQuats.set(semantic, obj.quaternion.clone());
          }
        }
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          // 元モデルのオレンジを、ステージに合うパールホワイト＋グラファイトに差し替える。
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const material of materials) {
            if (!(material instanceof THREE.MeshStandardMaterial)) continue;
            if (material.name === "Main") {
              material.color.set(0xb8c4d8);
              material.metalness = 0.18;
              material.roughness = 0.5;
              material.emissive.set(0x0a2a36);
              material.emissiveIntensity = 0.15;
            } else if (material.name === "Grey") {
              material.color.set(0x2b3446);
              material.metalness = 0.7;
              material.roughness = 0.35;
            } else if (material.name === "Black") {
              material.color.set(0x070a10);
              material.metalness = 0.4;
              material.roughness = 0.3;
              material.emissive.set(0x123a4a);
              material.emissiveIntensity = 0.5;
            }
          }
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      model.scale.setScalar(1.72 / Math.max(size.y, 0.001));
      box.setFromObject(model);
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;
      robotRoot.add(model);

      mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
      mixer.addEventListener("finished", (event) => {
        if (event.action === current) {
          fadeTo(baseClip);
          modeCallbackRef.current(mode);
        }
      });
      fadeTo(desiredClip);
      syncSpeed();
    });

    const setClip = (clip: string, bpm: number) => {
      audio.setBpm(bpm);
      if (clip === "Dance") {
        baseClip = "Dance";
        setMode("dance");
      } else if (clip === "Walking" || clip === "Running") {
        baseClip = clip;
        setMode("walk");
      }
      desiredClip = clip;
      fadeTo(clip);
      syncSpeed();
    };

    apiRef.current = {
      start: () => {
        void audio.start("neon").catch(() => {});
        danceCue = { ...danceCue, energy: 0.8 };
        baseClip = "Dance";
        desiredClip = "Dance";
        fadeTo("Dance");
        syncSpeed();
        setMode("dance");
        startedAt = performance.now() / 1000;
      },
      setClip,
      setMuted: (m) => audio.setMuted(m),
      setDucked: (d) => audio.setDucked(d),
      stopMusic: (fadeBars = 1) => {
        walkTarget = null;
        audio.stop(fadeBars);
        baseClip = "Idle";
        desiredClip = "Idle";
        fadeTo("Idle");
        setMode("idle");
      },
      playTrack: (trackId) => {
        walkTarget = null;
        void audio.playTrack(trackId).then(() => syncSpeed());
        baseClip = "Dance";
        desiredClip = "Dance";
        fadeTo("Dance");
        setMode("dance");
        syncSpeed();
      },
      walkTo: (mark) => {
        const target = MARKS[mark];
        walkTarget = new THREE.Vector3(target.x, 0, target.z);
        baseClip = "Walking";
        desiredClip = "Walking";
        fadeTo("Walking");
        syncSpeed();
        setMode("walk");
      },
      talk: () => {
        walkTarget = null;
        audio.setDucked(true);
        baseClip = "Idle";
        desiredClip = "Idle";
        fadeTo("Idle");
        setMode("talk");
      },
      dance: (input) => {
        walkTarget = null;
        if (typeof input.bpm === "number") audio.setBpm(input.bpm);
        danceCue = mergeDanceCue(danceCue, {
          style: input.style,
          energy: input.energy,
          moves: input.moves,
        });
        if (!audio.playing) void audio.start().catch(() => {});
        audio.setDucked(false);
        baseClip = "Dance";
        desiredClip = "Dance";
        fadeTo("Dance");
        syncSpeed();
        setMode("dance");
      },
      gesture: (intent) => {
        const clip =
          intent === "nod" ? "Yes" : intent === "point" ? "ThumbsUp" : intent === "celebrate" ? "Jump" : "Wave";
        desiredClip = clip;
        fadeTo(clip);
        syncSpeed();
      },
      getState: () => {
        const phase = audio.getPhase();
        return {
          mode,
          trackId: audio.track,
          trackName: TRACKS[audio.track].name,
          bpm: audio.bpm,
          playing: audio.playing,
          bar: phase.bar,
          beat: phase.beat,
          style: danceCue.style,
          energy: danceCue.energy,
        };
      },
    };

    const resize = () => {
      const width = host.clientWidth || window.innerWidth;
      const height = host.clientHeight || window.innerHeight;
      renderer.setSize(width, height);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const portrait = camera.aspect < 0.8;
      baseRadius = portrait ? 7.6 : camera.aspect < 1.2 ? 5.2 : 4.6;
      // 縦画面では背景スクリーンがUIと衝突するので消す。
      screen.visible = !portrait;
    };
    resize();
    window.addEventListener("resize", resize);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startedMs = performance.now();
    let lastMs = startedMs;
    let raf = 0;
    const animate = (nowMs: number) => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min((nowMs - lastMs) / 1000, 0.05);
      lastMs = nowMs;
      const t = (nowMs - startedMs) / 1000;

      // 歩行はルート移動、ダンスは拍に合わせた手続き層をクリップに重ねる。
      if (walkTarget) {
        const dx = walkTarget.x - stageX;
        const dz = walkTarget.z - stageZ;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.06) {
          walkTarget = null;
          const nextMode = audio.playing ? "dance" : "idle";
          baseClip = audio.playing ? "Dance" : "Idle";
          desiredClip = baseClip;
          fadeTo(baseClip);
          syncSpeed();
          setMode(nextMode);
        } else {
          const step = Math.min(dist, 0.9 * dt);
          stageX += (dx / dist) * step;
          stageZ += (dz / dist) * step;
          baseYaw = smoothAngle(baseYaw, Math.atan2(dx, dz), dt, 8);
        }
      } else {
        baseYaw = smoothAngle(baseYaw, 0, dt, 3);
      }

      mixer?.update(dt);

      const phase = audio.getPhase();
      const dancing = mode === "dance" && phase.playing && !reduceMotion;
      const walking = mode === "walk" && !reduceMotion;
      dancePose = dancing ? sampleDance(phase, danceCue) : null;
      applyRigPose(dancePose);
      smoothRootX = smooth(smoothRootX, dancePose?.rootX ?? 0, dt);
      smoothRootY = smooth(smoothRootY, dancePose?.rootY ?? 0, dt);
      smoothRootRoll = smooth(smoothRootRoll, dancePose?.rootRoll ?? 0, dt);
      smoothYaw = smoothAngle(smoothYaw, dancePose?.rootYaw ?? 0, dt);

      const bob = dancing ? smoothRootY : walking ? 0.012 : 0;
      robotRoot.position.x = stageX + smoothRootX;
      robotRoot.position.y = PLATFORM_TOP + bob;
      robotRoot.position.z = stageZ;
      robotRoot.rotation.y = baseYaw + smoothYaw;
      robotRoot.rotation.z = smoothRootRoll;
      contactShadow.position.x = robotRoot.position.x;
      contactShadow.position.z = robotRoot.position.z;
      if (dancePose) pulse = Math.max(pulse, dancePose.accent);

      pulse *= Math.exp(-dt * 6);
      spotA.intensity = 100 + pulse * 70;
      spotB.intensity = 80 + pulse * 55;
      platformMat.emissiveIntensity = 0.35 + pulse * 0.9;
      ring.scale.setScalar(1 + pulse * 0.012);
      innerRing.rotation.z = t * 0.12;
      particles.rotation.y = reduceMotion ? 0 : t * 0.02;

      const intro = startedAt < 0 ? 0 : Math.min(1, (nowMs / 1000 - startedAt) / 1.6);
      const ease = 1 - Math.pow(1 - intro, 3);
      const radius = baseRadius + (1 - ease) * 1.8;
      const angle = reduceMotion ? 0 : Math.sin(t * 0.12) * 0.22;
      camera.position.set(Math.sin(angle) * radius, 1.72, Math.cos(angle) * radius);
      camera.lookAt(0, 1.02, 0);

      composer.render();
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      audio.dispose();
      composer.dispose();
      pmrem.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
          obj.geometry?.dispose();
          const material = obj.material;
          const list = Array.isArray(material) ? material : [material];
          for (const m of list) {
            if (m instanceof THREE.MeshBasicMaterial && m.map) m.map.dispose();
            m.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      apiRef.current = null;
    };
  }, []);

  const startSession = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarted(true);
    setMcError(null);
    setClipLabel("DANCE");
    setShow((s) => ({ ...s, mode: "dance", playing: true }));
    apiRef.current?.start();
    void gemini.connect().catch((e) => setMcError((e as Error).message));
  };

  const runRequest = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setPrompt("");
    if (!startedRef.current) startSession();

    if (/止め|停止|stop|音楽.*(消|止)/i.test(text)) {
      applyAction({ type: "stopMusic", fadeBars: 1 });
      return;
    }
    if (/歩|walk|移動/i.test(text)) {
      const mark: MarkId = /左|left/i.test(text)
        ? "left"
        : /右|right/i.test(text)
          ? "right"
          : /前|front/i.test(text)
            ? "front"
            : showRef.current.mode === "walk"
              ? "center"
              : Math.random() > 0.5
                ? "left"
                : "right";
      applyAction({ type: "walkTo", mark });
      return;
    }
    if (/話|talk|mc|マイク/i.test(text)) {
      applyAction({ type: "talk" });
      if (gemini.state === "listening") {
        askMc(buildMcPrompt({ ...showRef.current, mode: "talk" }, true));
      }
      return;
    }
    if (/次|next|曲.*(変|チェンジ)|選曲/i.test(text)) {
      applyAction({ type: "playTrack", trackId: nextTrack(showRef.current.trackId) });
      return;
    }
    if (/再開|play|踊|dance|アゲ|上げ/i.test(text)) {
      const style = parseDanceStyle(text);
      const energy = /元気|アゲ|上げ|激|party|fast|up/i.test(text)
        ? 0.95
        : /ゆっくり|静か|スロー|slow|chill/i.test(text)
          ? 0.35
          : style === "hype"
            ? 0.8
            : 0.65;
      applyAction({
        type: "dance",
        bpm: parseBpm(text, showRef.current.bpm),
        energy,
        style,
        moves: defaultMoves(style),
      });
      return;
    }

    const request = parseRequest(text, showRef.current.bpm);
    apiRef.current?.setClip(request.clip, request.bpm);
    setClipLabel(request.label);
    setShow((s) => ({
      ...s,
      bpm: request.bpm,
      ...(request.clip === "Dance"
        ? { mode: "dance" as ShowMode, playing: true }
        : request.clip === "Walking"
          ? { mode: "walk" as ShowMode }
          : {}),
    }));
  };

  const toggleMute = () => {
    const value = !muted;
    setMuted(value);
    apiRef.current?.setMuted(value);
    gemini.setMuted(value);
  };

  const mcText = cleanMc(mcLine);
  const mcStatus =
    mcError ??
    (mcText ||
      (gemini.state === "connecting"
        ? "MIRAGE is tuning in…"
        : gemini.state === "listening"
          ? "…"
          : gemini.state === "error"
            ? "MC OFFLINE — stage only"
            : "MIRAGE will speak here."));

  return (
    <div className={`dj ${started ? "is-started" : ""}`}>
      <div className="dj-canvas" ref={hostRef} />

      <header className="dj-top">
        <div className="dj-brand">
          <span className="dj-brand-mark">MIRAGE</span>
          <span className="dj-brand-sub">AI DJ / 3D MOTION STAGE</span>
        </div>
        <div className="dj-top-right">
          <span className="dj-live">
            <i />
            LIVE
          </span>
          <button className="dj-icon" onClick={toggleMute} aria-label={muted ? "音を出す" : "音を消す"}>
            {muted ? "SOUND OFF" : "SOUND ON"}
          </button>
        </div>
      </header>

      <aside className="dj-readout" aria-live="polite">
        <span className="dj-readout-label">NOW / {clipLabel}</span>
        <strong className="dj-readout-clip">{show.mode.toUpperCase()}</strong>
        <span className="dj-readout-bpm">
          {show.trackName} · {show.bpm} BPM · {show.style.toUpperCase()} {Math.round(show.energy * 100)}
        </span>
      </aside>

      <div className="dj-hint">LLM DIRECTOR → STAGE</div>

      <footer className="dj-console">
        <div className="dj-mc" aria-live="polite">
          <span className="dj-mc-label">MC</span>
          <p>{mcStatus}</p>
        </div>
        <form
          className="dj-prompt"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim()) runRequest(prompt.trim());
          }}
        >
          <span className="dj-prompt-mark">›</span>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="動きを指示する  —  例: 元気に踊って"
            aria-label="動きの指示"
          />
          <button type="submit">RUN</button>
        </form>
        <div className="dj-chips">
          {QUICK.map((item) => (
            <button key={item.prompt} onClick={() => runRequest(item.prompt)}>
              {item.label}
            </button>
          ))}
        </div>
        <p className="dj-note">GEMINI LIVE MC + PROCEDURAL BODY / CLIPS AS ATOMS</p>
      </footer>

      <div className={`dj-start ${started ? "is-hidden" : ""}`}>
        <div className="dj-start-inner">
          <p className="dj-kicker">MIRAGE LAB / 2026</p>
          <h1>
            AI DJ
            <span>ダンスステージ</span>
          </h1>
          <p className="dj-start-copy">AI DJが考えて、喋って、踊る。</p>
          <button onClick={startSession}>START SESSION</button>
          <small>音が出ます / ヘッドホン推奨 / MCはGemini Live</small>
        </div>
      </div>
    </div>
  );
}
