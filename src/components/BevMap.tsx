import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { VisitorTracker } from "../tracking/visitorTracker";
import { ROOM, type Furniture } from "./roomLayout";

interface BevMapProps {
  trackerRef: RefObject<VisitorTracker | null>;
  visible: boolean;
}

const W = 400;
const H = 480;

// 奥行きの見え方。D_NEARが画面下端、D_FARが地平線付近。
const D_NEAR = 0.6; // m
const D_FAR = 8; // m
const HORIZON_RATIO = 0.4; // 画面高さに対する地平線
const PERSON_HEIGHT_M = 1.7;
const SCALE_AT_1M = 0.22; // 1m先の1m幅が画面高さの何倍か
// 正規化x→横m。実カメラFOV相当は1.2だが、マップとして見やすく誇張する
const LAT_M_PER_DEPTH = 2.4;
const SMOOTH = 8; // 追従の速さ(1/s)。150ms間隔の更新をならす

interface Projected {
  sx: number;
  sy: number;
  pxPerM: number;
}

interface Rendered {
  sx: number;
  sy: number;
  h: number;
  d: number;
  x: number;
}

/** 横m・奥行きm → 画面上の位置。奥ほど上・小さく。 */
export function project(latM: number, d: number): Projected {
  const horizon = H * HORIZON_RATIO;
  const cluster = (H - horizon) * D_NEAR;
  const dd = Math.min(Math.max(d, D_NEAR), D_FAR);
  const pxPerM = (H * SCALE_AT_1M) / dd;
  return { sx: W / 2 + latM * pxPerM, sy: horizon + cluster / dd, pxPerM };
}

/**
 * 周囲マップ（Teslaのセンター画面風）。
 * カメラが自機なので「車」ではなく来場者を人型シルエットで、家具を箱で描く。
 * three は使わずCanvas 2Dの投影のみ。
 */
export function BevMap({ trackerRef, visible }: BevMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // idごとの描画位置。トラッカーは150ms間隔なので、ここで60fpsにならす
    const rendered = new Map<string, Rendered>();
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      draw(ctx, trackerRef.current, rendered, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(raf);
  }, [visible, trackerRef]);

  if (!visible) return null;
  return (
    <canvas
      ref={canvasRef}
      style={{ width: W, height: H, display: "block", borderRadius: 8, border: "1px solid #1e293b" }}
    />
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  tracker: VisitorTracker | null,
  rendered: Map<string, Rendered>,
  dt: number
) {
  const horizon = H * HORIZON_RATIO;
  const cx = W / 2;

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#070a0e");
  bg.addColorStop(0.4, "#0b1017");
  bg.addColorStop(1, "#101822");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 地面グリッド
  ctx.strokeStyle = "rgba(96,165,250,0.10)";
  ctx.lineWidth = 1;
  for (let m = 1; m <= D_FAR; m++) {
    const { sy } = project(0, m);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(W, sy);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(96,165,250,0.06)";
  for (let i = 0; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, horizon);
    ctx.lineTo((W * i) / 6, H);
    ctx.stroke();
  }

  // 距離目盛り
  ctx.fillStyle = "rgba(148,163,184,0.45)";
  ctx.font = `${Math.round(H * 0.024)}px ui-monospace, monospace`;
  for (const m of [2, 4, 6, 8]) {
    const { sy } = project(0.9, m);
    ctx.fillText(`${m}m`, 8, sy - 4);
  }

  // 足元のグロー（自機位置）
  const glow = ctx.createRadialGradient(cx, H, 0, cx, H, W * 0.5);
  glow.addColorStop(0, "rgba(56,189,248,0.10)");
  glow.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, horizon, W, H - horizon);

  // 家具は奥から
  for (const f of [...ROOM].sort((a, b) => b.d - a.d)) drawFurniture(ctx, f);

  // 来場者の追従
  const active = tracker?.getActive() ?? [];
  const alive = new Set<string>();
  const k = 1 - Math.exp(-SMOOTH * dt);

  for (const v of active) {
    const cur = v.positions[v.positions.length - 1];
    const d = v.d ?? v.dRaw ?? cur?.d ?? null;
    if (!cur || d === null) continue;

    alive.add(v.id);
    const latM = (0.5 - cur.x) * d * LAT_M_PER_DEPTH;
    const t = project(latM, d);
    const h = PERSON_HEIGHT_M * t.pxPerM;
    const prev = rendered.get(v.id);
    rendered.set(
      v.id,
      prev
        ? {
            sx: prev.sx + (t.sx - prev.sx) * k,
            sy: prev.sy + (t.sy - prev.sy) * k,
            h: prev.h + (h - prev.h) * k,
            d: prev.d + (d - prev.d) * k,
            x: prev.x + (cur.x - prev.x) * k,
          }
        : { sx: t.sx, sy: t.sy, h, d, x: cur.x }
    );
  }
  for (const id of rendered.keys()) if (!alive.has(id)) rendered.delete(id);

  for (const p of [...rendered.values()].sort((a, b) => b.d - a.d)) drawPerson(ctx, p);

  if (active.length === 0) {
    ctx.fillStyle = "rgba(100,116,139,0.8)";
    ctx.fillText("no visitors", 8, 18);
  }
}

function drawFurniture(ctx: CanvasRenderingContext2D, f: Furniture) {
  const near = f.d - f.dep / 2;
  const far = f.d + f.dep / 2;
  const left = f.lat - f.w / 2;
  const right = f.lat + f.w / 2;

  const nL = project(left, near);
  const nR = project(right, near);
  const fL = project(left, far);
  const fR = project(right, far);
  const lift = (p: Projected) => f.h * p.pxPerM;

  const isDesk = f.kind === "desk";
  const top = isDesk ? "#2a3a4e" : "#334155";
  const side = isDesk ? "#18202c" : "#1f2937";

  // 手前の側面
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.moveTo(nL.sx, nL.sy);
  ctx.lineTo(nR.sx, nR.sy);
  ctx.lineTo(nR.sx, nR.sy - lift(nR));
  ctx.lineTo(nL.sx, nL.sy - lift(nL));
  ctx.closePath();
  ctx.fill();

  // 上面
  ctx.fillStyle = top;
  ctx.strokeStyle = "rgba(148,163,184,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(fL.sx, fL.sy - lift(fL));
  ctx.lineTo(fR.sx, fR.sy - lift(fR));
  ctx.lineTo(nR.sx, nR.sy - lift(nR));
  ctx.lineTo(nL.sx, nL.sy - lift(nL));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawPerson(ctx: CanvasRenderingContext2D, p: Rendered) {
  const { sx, sy, h } = p;
  if (h <= 0) return;
  const w = h * 0.32;

  // 近すぎる相手は薄く
  const alpha = Math.min(1, Math.max(0.15, (p.d - 0.7) / 0.4));

  // 接地影
  ctx.fillStyle = `rgba(0,0,0,${0.45 * alpha})`;
  ctx.beginPath();
  ctx.ellipse(sx, sy, w * 0.7, w * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // 体
  const bodyH = h * 0.78;
  const bodyW = w * 0.62;
  const grad = ctx.createLinearGradient(0, sy - bodyH, 0, sy);
  grad.addColorStop(0, `rgba(214,226,240,${0.92 * alpha})`);
  grad.addColorStop(1, `rgba(120,140,165,${0.75 * alpha})`);

  ctx.save();
  ctx.shadowColor = `rgba(120,190,255,${0.45 * alpha})`;
  ctx.shadowBlur = Math.max(4, h * 0.04);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(sx - bodyW / 2, sy - bodyH, bodyW, bodyH, bodyW * 0.42);
  ctx.fill();
  ctx.restore();

  // 頭
  ctx.fillStyle = `rgba(226,236,248,${0.95 * alpha})`;
  ctx.beginPath();
  ctx.arc(sx, sy - h * 0.86, h * 0.085, 0, Math.PI * 2);
  ctx.fill();
}
