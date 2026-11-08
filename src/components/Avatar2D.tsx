import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createAvatar2DState, stepAvatar2D } from "./avatar2dState";
import { CatAvatar } from "./CatAvatar";
import type { FaceCenter } from "../hooks/useFaceDetection";

export interface Avatar2DProps {
  speakingRef?: RefObject<boolean>;
  volumeRef?: RefObject<number>;
  faceCenterRef?: RefObject<FaceCenter | null>;
  eyeCenterRef?: RefObject<FaceCenter | null>;
  paused?: boolean;
}

interface AvatarRig {
  file: string;
  /** 座標は画像に対する %。無ければまばたきしない */
  eyes?: { x: number; y: number; gap: number; rx: number; ry: number; color: string };
  /** 無ければ口パクしない */
  mouth?: { x: number; y: number; rx: number; ry: number; color: string };
}

const DEFAULT_RIG: AvatarRig = { file: "" };

/**
 * 2Dアバター。既定は三毛猫（CatAvatar）。`public/avatar/avatar.json` に画像を書けば差し替えられる。
 * 呼吸・揺れ・視差・口パク・耳の動きは毎フレーム計算して CSS 変数で流す（React再描画なし）。
 */
export function Avatar2D({ speakingRef, volumeRef, faceCenterRef, eyeCenterRef, paused }: Avatar2DProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [rig, setRig] = useState<AvatarRig | null>(null);
  const [missing, setMissing] = useState(false);

  // 目・口の座標はデータで上書きできるようにする（コードを触らず調整するため）
  useEffect(() => {
    let alive = true;
    fetch("/avatar/avatar.json")
      .then((res) =>
        res.ok && res.headers.get("content-type")?.includes("json") ? res.json() : null,
      )
      .then((data: AvatarRig | null) => {
        if (alive && data?.file) setRig({ ...DEFAULT_RIG, ...data });
      })
      .catch(() => {
        /* 設定が無いだけ。既定で動く */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || paused) return;

    let state = createAvatar2DState();
    let last = performance.now();
    let raf = 0;
    // 耳のぴくっと（3〜8秒に1回、0.24秒）
    let nextTwitch = 2500 + Math.random() * 3500;
    let twitchStart = -1;
    let twitchSide = 1;
    // ひとりでにやる仕草
    type Behavior = "look" | "yawn" | "groom" | "wave";
    const DURATION: Record<Behavior, number> = {
      look: 2800,
      yawn: 2800,
      groom: 3800,
      wave: 2200,
    };
    let behavior: Behavior | null = null;
    let behaviorStart = 0;
    let nextIdle = 4000 + Math.random() * 4000;
    let greeted = false;
    let earFlat = 0;
    let listenAmt = 0;

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      const speakingNow = speakingRef?.current ?? false;
      const volumeNow = volumeRef?.current ?? 0;
      const next = stepAvatar2D(state, dt, {
        speaking: speakingNow,
        volume: volumeNow,
        time: now / 1000,
        face: faceCenterRef?.current ?? null,
        eye: eyeCenterRef?.current ?? null,
      });
      state = next.state;

      // 仕草の開始・終了。会話中と来訪者の発話中は割り込まない
      const listening = !speakingNow && volumeNow > 0.02;
      if (speakingNow && !greeted) {
        greeted = true;
        behavior = "wave";
        behaviorStart = now;
      }
      if (behavior && now - behaviorStart > DURATION[behavior]) {
        behavior = null;
        nextIdle = now + 5000 + Math.random() * 7000;
      }
      if (!behavior && !speakingNow && !listening && now > nextIdle) {
        const r = Math.random();
        behavior = r < 0.45 ? "look" : r < 0.75 ? "groom" : "yawn";
        behaviorStart = now;
      }

      let headX = 0;
      let headY = 0;
      let headRot = 0;
      let lookX = 0;
      let mouthBoost = 0;
      let squint = 0;
      let happy = 0;
      let tongue = 0;
      let pawAngle = 0;
      let pawShow = 0;
      let flat = 0;

      if (behavior) {
        const t = (now - behaviorStart) / DURATION[behavior];
        if (behavior === "look") {
          const swing = Math.sin(t * Math.PI * 2);
          headX = swing * 11;
          headRot = swing * 3.5;
          lookX = swing * 2.5;
        } else if (behavior === "yawn") {
          const e = Math.sin(t * Math.PI);
          mouthBoost = 1.35 * e;
          squint = e;
          headY = -9 * e;
          flat = 20 * e;
        } else if (behavior === "groom") {
          const e = Math.min(1, t / 0.2) * Math.min(1, (1 - t) / 0.2);
          headX = 10 * e;
          headY = 16 * e + Math.sin(t * Math.PI * 8) * 2 * e;
          headRot = 8 * e;
          tongue = e * (0.65 + 0.35 * Math.sin(t * Math.PI * 10));
          squint = 0.6 * e;
          mouthBoost = 0.2 * e;
        } else {
          const lift = Math.min(1, t / 0.18) * Math.min(1, (1 - t) / 0.18);
          pawAngle = (-132 + Math.sin(t * Math.PI * 8) * 9) * lift;
          pawShow = lift;
          happy = lift;
          headRot = -3 * lift;
        }
      }

      // 来訪者が話している間は「うんうん」と小さくうなずく
      listenAmt += ((listening ? 1 : 0) - listenAmt) * 0.12;
      headY += listenAmt * (2 + Math.sin(now / 300) * 2);
      headRot += listenAmt * Math.sin(now / 600) * 1.2;

      const mouthOut = Math.max(next.state.mouth, mouthBoost);
      el.style.setProperty("--blink", String(next.blink));
      el.style.setProperty("--mouth", String(mouthOut));
      el.style.setProperty("--head-x", `${headX}px`);
      el.style.setProperty("--head-y", `${headY}px`);
      el.style.setProperty("--head-rot", `${headRot}deg`);
      el.style.setProperty("--look-x", `${lookX}px`);
      el.style.setProperty("--squint", String(squint));
      el.style.setProperty("--happy", String(happy));
      el.style.setProperty("--tongue", String(tongue));
      el.style.setProperty("--paw-angle", `${pawAngle}deg`);
      el.style.setProperty("--paw-show", String(pawShow));
      el.style.setProperty("--gaze-x", `${next.state.gazeX}px`);
      el.style.setProperty("--gaze-y", `${next.state.gazeY}px`);
      el.style.setProperty("--par-x", `${next.state.parX}px`);
      el.style.setProperty("--par-y", `${next.state.parY}px`);
      // 来訪者の方へ少し傾く（視差と同じ入力。角度は控えめに）
      el.style.setProperty("--lean", `${next.state.parX * 0.06}deg`);
      // 呼吸（3.6秒周期）と、話している間の小さな上下。静止画でも「生きてる」ように見せる
      el.style.setProperty("--breath", String(1 + Math.sin(now / 1800) * 0.006));
      el.style.setProperty("--sway", `${Math.sin(now / 3200) * 0.7}deg`);
      el.style.setProperty("--bob", `${mouthOut * -3}px`);
      // ホログラム素材向け: ゆっくり浮遊し、発話中は発光が強くなる（口パクの代わり）
      el.style.setProperty("--float", `${Math.sin(now / 2400) * 5}px`);
      el.style.setProperty(
        "--shine",
        String(1 + Math.sin(now / 2600) * 0.04 + mouthOut * 0.2),
      );
      if (now > nextTwitch) {
        twitchStart = now;
        twitchSide = Math.random() < 0.5 ? -1 : 1;
        nextTwitch = now + 3000 + Math.random() * 5000;
      }
      const twitchP = twitchStart >= 0 ? (now - twitchStart) / 240 : 1;
      const twitch = twitchP < 1 ? Math.sin(twitchP * Math.PI) * 10 : 0;
      // 聞いている間とあくび中は耳を後ろへ倒す。ぴくっとは別に足す
      const flatTarget = (listening ? 12 : 0) + flat;
      earFlat += (flatTarget - earFlat) * 0.15;
      const earL = (twitchSide < 0 ? twitch : 0) - earFlat;
      const earR = (twitchSide > 0 ? -twitch : 0) + earFlat;
      el.style.setProperty("--ear-l", `${earL}deg`);
      el.style.setProperty("--ear-r", `${earR}deg`);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, speakingRef, volumeRef, faceCenterRef, eyeCenterRef]);

  return (
    <div ref={rootRef} style={wrapStyle} className="avatar-wrap" aria-hidden="true">
      <div className="avatar-ground" />
      <div style={stageStyle}>
        <div style={bodyStyle} className="avatar-body">
          {rig?.file && !missing ? (
            <>
              <img
                src={rig.file}
                alt=""
                draggable={false}
                style={imgStyle}
                onError={() => setMissing(true)}
              />
              {rig.eyes && (
                <>
                  <span style={{ ...lidStyle, ...eyeBox(rig.eyes, -1, rig.eyes.color) }} />
                  <span style={{ ...lidStyle, ...eyeBox(rig.eyes, 1, rig.eyes.color) }} />
                </>
              )}
              {rig.mouth && <span style={{ ...mouthPatchStyle, ...mouthBox(rig.mouth) }} />}
            </>
          ) : (
            <CatAvatar />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- 座標計算（画像に対する %） ----

function eyeBox(eyes: NonNullable<AvatarRig["eyes"]>, side: -1 | 1, color: string): CSSProperties {
  return {
    left: `${eyes.x + (side * eyes.gap) / 2}%`,
    top: `${eyes.y}%`,
    width: `${eyes.rx * 2}%`,
    height: `${eyes.ry * 2}%`,
    background: color,
  };
}

function mouthBox(mouth: NonNullable<AvatarRig["mouth"]>): CSSProperties {
  return {
    left: `${mouth.x}%`,
    top: `${mouth.y}%`,
    width: `${mouth.rx * 2}%`,
    height: `${mouth.ry * 2}%`,
    background: `radial-gradient(ellipse at 50% 45%, #031a33 45%, #2f9fe0 80%, #cdf5ff 100%)`,
    // ホログラムの口は「光る」ので、塗りより発光で見せる
    boxShadow: `0 0 14px ${mouth.color}, inset 0 0 4px ${mouth.color}`,
  };
}

// ---- スタイル ----

const wrapStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
};

// 視差: 顔の動きに合わせて全体が少しついてくる。浮遊は常時ゆっくり上下
const stageStyle: CSSProperties = {
  transform: "translate(var(--par-x, 0px), calc(var(--par-y, 0px) + var(--float, 0px) - 3vh))",
  willChange: "transform",
};

// 呼吸・揺れ・発話時の上下。浮遊するキャラなので中央を支点にする
const bodyStyle: CSSProperties = {
  position: "relative",
  transformOrigin: "center",
  transform:
    "translateY(var(--bob, 0px)) rotate(calc(var(--sway, 0deg) + var(--lean, 0deg))) scaleY(var(--breath, 1))",
  willChange: "transform",
};

const imgStyle: CSSProperties = {
  height: "100%",
  width: "auto",
  display: "block",
  userSelect: "none",
  filter: "brightness(var(--shine, 1))",
};

// --blink: 0=開く / 1=閉じる（画像の上にまぶたを重ねる）
const lidStyle: CSSProperties = {
  position: "absolute",
  borderRadius: "50%",
  transform: "translate(-50%, -50%)",
  opacity: "var(--blink, 0)",
  pointerEvents: "none",
};

// --mouth: 0=閉じる / 1=大きく開く
const mouthPatchStyle: CSSProperties = {
  position: "absolute",
  borderRadius: "50%",
  transform: "translate(-50%, -50%) scaleY(calc(0.12 + 1.6 * var(--mouth, 0)))",
  transformOrigin: "center",
  opacity: 0.9,
  pointerEvents: "none",
};
