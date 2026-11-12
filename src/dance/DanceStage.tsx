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
  isDanceMove,
  isDanceStyle,
  mergeDanceCue,
  type DanceCue,
  type DanceMove,
  type DanceStyle,
} from "./dance";
import { clipForStyle, clipStartOffset, loadMixamoRig, timeScaleForClip } from "./mixamo";
import { DJ_SYSTEM_PROMPT, DJ_TOOLS, buildMcPrompt } from "./mc";
import {
  MARKS,
  TRACKS,
  sectionAtBar,
  type MarkId,
  type ShowAction,
  type ShowMode,
  type ShowState,
  type TrackId,
} from "./show";
import "./dance.css";

const PLATFORM_TOP = 0.14;
const BASE_BPM = TRACKS.neon.bpm;

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
    section: "intro",
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
        break;
      case "stopMusic":
        api.stopMusic(action.fadeBars);
        break;
      case "playTrack":
        api.playTrack(action.trackId);
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
        if (action.clip !== "Dance") setClipLabel(action.clip.toUpperCase());
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
            trackId: "neon",
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
          prev.section === state.section &&
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
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.055);

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

    // 黒い空間に奥行きを作る。床は大きく、グリッドはフォグで消える。
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(24, 96),
      new THREE.MeshStandardMaterial({ color: 0x020305, metalness: 0.75, roughness: 0.42 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(40, 80, 0x102a44, 0x07111d);
    grid.position.y = 0.002;
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.32;
    scene.add(grid);

    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x05070d,
      metalness: 0.7,
      roughness: 0.34,
      emissive: new THREE.Color(0x071724),
      emissiveIntensity: 0.25,
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

    const spotA = new THREE.SpotLight(0x5ee7ff, 55, 20, 0.6, 0.9, 2);
    spotA.position.set(3.2, 5.4, 1.6);
    spotA.target.position.set(0, 1, 0);
    scene.add(spotA, spotA.target);

    const spotB = new THREE.SpotLight(0xff5fb2, 40, 20, 0.55, 1, 2);
    spotB.position.set(-3.2, 4.6, -1.2);
    spotB.target.position.set(0, 1, 0);
    scene.add(spotB, spotB.target);

    // 黒いステージで人物の顔と服が沈まないためのフロント光。
    const front = new THREE.DirectionalLight(0xffffff, 1.15);
    front.position.set(0.6, 2.8, 4.5);
    front.target.position.set(0, 1.15, 0);
    scene.add(front, front.target);

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
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 1.02);
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
    let autoDance = false;
    let justRestarted = false;
    let styleOverride: DanceStyle | null = null;
    let sectionStartBar = -1;
    type PendingAction = { kind: "stop" | "play" | "dance"; run: () => void };
    let pendingAtBar: PendingAction | null = null;
    let disposed = false;
    let startedAt = -1;
    let baseRadius = 4.2;
    let stageX = 0;
    let stageZ = 0;
    let baseYaw = 0;

    const setMode = (next: ShowMode) => {
      if (mode === next) return;
      mode = next;
      modeCallbackRef.current(next);
    };

    // クリップ1周が整数小節になる再生速度。ループの継ぎ目を小節頭に戻す土台。
    const syncSpeed = () => {
      if (!current) return;
      current.timeScale = timeScaleForClip(current.getClip(), audio.bpm);
    };

    const fadeTo = (name: string, alignToBeat = false) => {
      const next = actions.get(name) ?? actions.get("Idle");
      if (!next) return;
      if (next === current) {
        next.play();
        return;
      }
      next.reset();
      if (alignToBeat) next.time = clipStartOffset(name);
      next.enabled = true;
      next.setEffectiveWeight(1);
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
      next.play();
      if (current) current.crossFadeTo(next, 0.28, false);
      else next.fadeIn(0.35);
      current = next;
      syncSpeed();
    };

    // 小節ごとにセクションを引き、ダンスクリップを小節頭で切り替える。
    // MC の style 指定は、そのセクションの間だけ上書きとして使う。
    const applySection = (bar: number, override?: DanceStyle) => {
      const section = sectionAtBar(TRACKS[audio.track], bar);
      if (section.startBar !== sectionStartBar) {
        sectionStartBar = section.startBar;
        styleOverride = null;
      }
      if (override) styleOverride = override;
      const style = styleOverride ?? section.style;
      danceCue = { ...danceCue, style, energy: section.energy };
      if (mode !== "dance" || walkTarget) return;
      const clip = clipForStyle(style);
      baseClip = clip;
      desiredClip = clip;
      fadeTo(clip, true);
    };

    audio.onBar = () => {
      const bar = audio.getPhase().bar;
      const pending = pendingAtBar;
      pendingAtBar = null;
      pending?.run();
      if (justRestarted) {
        justRestarted = false;
        return;
      }
      if (autoDance && audio.playing && !walkTarget) {
        autoDance = false;
        setMode("dance");
      }
      if (mode === "dance" && !walkTarget) applySection(bar);
    };

    const smoothAngle = (value: number, target: number, dt: number, rate = 10) => {
      const delta = Math.atan2(Math.sin(target - value), Math.cos(target - value));
      return value + delta * (1 - Math.exp(-rate * dt));
    };

    // Mixamo: Michelle + モーションキャプチャのダンスクリップ。
    const loader = new GLTFLoader();
    loadMixamoRig(loader)
      .then((rig) => {
        if (disposed) return;
        robotRoot.add(rig.model);
        mixer = rig.mixer;
        for (const [name, action] of rig.actions) actions.set(name, action);
        fadeTo(desiredClip);
      })
      .catch((error) => console.error("MIXAMO load failed", error));

    const setClip = (clip: string, bpm: number) => {
      if (clip === "Dance") {
        if (!audio.playing) {
          audio.setBpm(bpm);
          void audio.start().catch(() => {});
          autoDance = true;
          baseClip = "Idle";
          desiredClip = "Idle";
          fadeTo("Idle", true);
          setMode("idle");
          return;
        }
        pendingAtBar = {
          kind: "dance",
          run: () => {
            audio.setBpm(bpm);
            autoDance = false;
            setMode("dance");
            applySection(audio.getPhase().bar);
            syncSpeed();
          },
        };
        return;
      }
      if (clip === "Walking" || clip === "Running") {
        baseClip = "Walking";
        setMode("walk");
      } else {
        baseClip = clip;
      }
      desiredClip = baseClip;
      fadeTo(baseClip);
    };

    apiRef.current = {
      start: () => {
        void audio.start("neon").catch(() => {});
        pendingAtBar = null;
        justRestarted = false;
        autoDance = true;
        styleOverride = null;
        sectionStartBar = -1;
        baseClip = "Idle";
        desiredClip = "Idle";
        fadeTo("Idle", true);
        setMode("idle");
        startedAt = performance.now() / 1000;
      },
      setClip,
      setMuted: (m) => audio.setMuted(m),
      setDucked: (d) => audio.setDucked(d),
      stopMusic: (fadeBars = 1) => {
        const stop = () => {
          audio.stop(fadeBars);
          autoDance = false;
          styleOverride = null;
          sectionStartBar = -1;
          if (!walkTarget && mode !== "talk") {
            baseClip = "Idle";
            desiredClip = "Idle";
            fadeTo("Idle", true);
            setMode("idle");
          }
        };
        if (audio.playing) pendingAtBar = { kind: "stop", run: stop };
        else stop();
      },
      playTrack: (trackId) => {
        const play = (insideBar: boolean) => {
          if (insideBar) justRestarted = true;
          autoDance = true;
          styleOverride = null;
          sectionStartBar = -1;
          if (!walkTarget && mode !== "talk") {
            baseClip = "Idle";
            desiredClip = "Idle";
            fadeTo("Idle", true);
            setMode("idle");
          }
          void audio.playTrack(trackId).then(() => syncSpeed());
        };
        if (audio.playing) pendingAtBar = { kind: "play", run: () => play(true) };
        else play(false);
      },
      walkTo: (mark) => {
        if (pendingAtBar?.kind === "dance") pendingAtBar = null;
        const target = MARKS[mark];
        walkTarget = new THREE.Vector3(target.x, 0, target.z);
        baseClip = "Walking";
        desiredClip = "Walking";
        fadeTo("Walking");
        setMode("walk");
      },
      talk: () => {
        if (pendingAtBar?.kind === "dance") pendingAtBar = null;
        walkTarget = null;
        audio.setDucked(true);
        autoDance = false;
        baseClip = "Idle";
        desiredClip = "Idle";
        fadeTo("Idle");
        setMode("talk");
      },
      dance: (input) => {
        const apply = () => {
          walkTarget = null;
          if (typeof input.bpm === "number") audio.setBpm(input.bpm);
          danceCue = mergeDanceCue(danceCue, {
            style: input.style,
            energy: input.energy,
            moves: input.moves,
          });
          audio.setDucked(false);
          if (!audio.playing) {
            autoDance = true;
            if (input.style) styleOverride = input.style;
            sectionStartBar = sectionAtBar(TRACKS[audio.track], audio.getPhase().bar).startBar;
            baseClip = "Idle";
            desiredClip = "Idle";
            fadeTo("Idle", true);
            setMode("idle");
            void audio.start().catch(() => {});
            return;
          }
          autoDance = false;
          setMode("dance");
          applySection(audio.getPhase().bar, input.style);
          syncSpeed();
        };
        if (audio.playing) pendingAtBar = { kind: "dance", run: apply };
        else apply();
      },
      gesture: (_intent) => {
        // MC のジェスチャーは今はダンスを止めない。Live 再接続時に専用クリップを足す。
      },
      getState: () => {
        const phase = audio.getPhase();
        const track = TRACKS[audio.track];
        const section = sectionAtBar(track, phase.bar);
        const style = section.startBar === sectionStartBar ? (styleOverride ?? section.style) : section.style;
        return {
          mode,
          trackId: audio.track,
          trackName: track.name,
          bpm: audio.bpm,
          playing: audio.playing,
          bar: phase.bar,
          beat: phase.beat,
          section: section.id,
          style,
          energy: section.energy,
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
      baseRadius = portrait ? 6.6 : camera.aspect < 1.2 ? 4.9 : 4.2;
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

      // 歩行はルート移動。ダンスは Mixamo クリップを拍に合わせて再生する。
      if (walkTarget) {
        const dx = walkTarget.x - stageX;
        const dz = walkTarget.z - stageZ;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.06) {
          walkTarget = null;
          // 到着後は即ダンスへ戻さず、次の小節頭でセクションのクリップに入る。
          autoDance = audio.playing;
          baseClip = "Idle";
          desiredClip = "Idle";
          fadeTo("Idle", true);
          setMode("idle");
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

      robotRoot.position.set(stageX, PLATFORM_TOP, stageZ);
      robotRoot.rotation.y = baseYaw;

      contactShadow.position.x = robotRoot.position.x;
      contactShadow.position.z = robotRoot.position.z;

      pulse *= Math.exp(-dt * 6);
      spotA.intensity = 55 + pulse * 45;
      spotB.intensity = 40 + pulse * 35;
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
          const mapKeys = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"] as const;
          for (const m of list) {
            const textures = m as unknown as Record<string, THREE.Texture | undefined>;
            for (const key of mapKeys) textures[key]?.dispose();
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
    setClipLabel("IDLE");
    setShow((s) => ({ ...s, mode: "idle", playing: true }));
    apiRef.current?.start();
  };

  const toggleMute = () => {
    const value = !muted;
    setMuted(value);
    apiRef.current?.setMuted(value);
    gemini.setMuted(value);
  };

  const mcText = cleanMc(mcLine);
  const mcCaption =
    mcError ??
    (mcText ||
      (gemini.state === "connecting"
        ? "MIRAGE is tuning in…"
        : gemini.state === "error"
          ? "MC OFFLINE — stage only"
          : ""));

  return (
    <div className={`dj ${started ? "is-started" : ""}`}>
      <div className="dj-canvas" ref={hostRef} />

      <header className="dj-top">
        <div className="dj-brand">
          <span className="dj-brand-mark">MIRAGE</span>
          <span className="dj-brand-sub">REAL-TIME DANCE STAGE</span>
        </div>
        <div className="dj-top-right">
          <span className="dj-live">
            <i />
            LIVE
          </span>
          <button
            className="dj-icon"
            onClick={() => (show.playing ? apiRef.current?.stopMusic(1) : apiRef.current?.playTrack("neon"))}
            aria-label={show.playing ? "音楽を止める" : "音楽をかける"}
          >
            {show.playing ? "STOP MUSIC" : "PLAY MUSIC"}
          </button>
          <button className="dj-icon" onClick={toggleMute} aria-label={muted ? "音を出す" : "音を消す"}>
            {muted ? "SOUND OFF" : "SOUND ON"}
          </button>
        </div>
      </header>

      <aside className="dj-readout" aria-live="polite">
        <span className="dj-readout-label">NOW / {clipLabel}</span>
        <strong className="dj-readout-clip">{show.mode.toUpperCase()}</strong>
        <span className="dj-readout-bpm">
          {show.trackName} · {show.bpm} BPM · {show.section.toUpperCase()}/{show.style.toUpperCase()}{" "}
          {Math.round(show.energy * 100)}
        </span>
      </aside>

      {mcCaption && (
        <p className="dj-subtitle" aria-live="polite">
          {mcCaption}
        </p>
      )}

      <div className={`dj-start ${started ? "is-hidden" : ""}`}>
        <div className="dj-start-inner">
          <p className="dj-kicker">MIRAGE LAB / 2026</p>
          <h1>
            MIRAGE
            <span>DANCE STAGE</span>
          </h1>
          <p className="dj-start-copy">PLEASE TURN UP THE VOLUME.</p>
          <button onClick={startSession}>START SESSION</button>
          <small>SOUND WILL PLAY / HEADPHONES RECOMMENDED</small>
        </div>
      </div>
    </div>
  );
}
