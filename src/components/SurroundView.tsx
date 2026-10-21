import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { VisitorTracker } from "../tracking/visitorTracker";

interface SurroundViewProps {
  trackerRef: RefObject<VisitorTracker | null>;
}

// 奥行きの見え方。D_NEARが画面下端、D_FARが地平線付近。
const D_NEAR = 0.7; // m
const D_FAR = 8; // m
const HORIZON_RATIO = 0.42; // 画面高さに対する地平線の位置
const PERSON_HEIGHT_M = 1.7;
const SCALE_AT_1M = 0.324; // 1m先の1m幅が画面高さの何倍か
const LATERAL_SPREAD = 0.9; // 顔の左右位置を画面幅のどこまで使うか
const SMOOTH = 8; // 追従の速さ(1/s)。150ms間隔の更新をならす

interface Projected {
  sx: number;
  sy: number;
  h: number;
  d: number;
  x: number;
}

export function project(x: number, d: number, W: number, H: number) {
  const horizon = H * HORIZON_RATIO;
  const cluster = (H - horizon) * D_NEAR;
  const dd = Math.min(Math.max(d, D_NEAR), D_FAR);
  // 奥ほど中心へ寄せる＝遠近感
  const spread = LATERAL_SPREAD * (0.45 + 0.55 * (D_NEAR / dd));
  return {
    sx: W / 2 + (0.5 - x) * W * spread,
    sy: horizon + cluster / dd,
    h: Math.min(PERSON_HEIGHT_M * ((H * SCALE_AT_1M) / dd), H * 0.9),
  };
}

/**
 * Teslaのセンター画面風の周囲ビュー。
 * カメラが自機なので「車」ではなく来場者を人型シルエットで描く。
 * three は使わずCanvas 2Dの透視投影のみ。デバッグ用のBevMapとは別物。
 */
export function SurroundView({ trackerRef }: SurroundViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // idごとの描画位置。トラッカーは150ms間隔なので、ここで60fpsにならす
    const rendered = new Map<string, Projected>();
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      draw(ctx, W, H, trackerRef.current, rendered, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [trackerRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  tracker: VisitorTracker | null,
  rendered: Map<string, Projected>,
  dt: number
) {
  if (W <= 0 || H <= 0) return;

  const horizon = H * HORIZON_RATIO;
  const cx = W / 2;

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#070a0e");
  bg.addColorStop(0.45, "#0b1017");
  bg.addColorStop(1, "#101822");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 地面グリッド（奥行き）
  ctx.strokeStyle = "rgba(96,165,250,0.10)";
  ctx.lineWidth = 1;
  for (let m = 1; m <= D_FAR; m++) {
    const { sy } = project(0.5, m, W, H);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(W, sy);
    ctx.stroke();
  }
  // 消失点へ向かう線
  ctx.strokeStyle = "rgba(96,165,250,0.06)";
  for (let i = 0; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, horizon);
    ctx.lineTo((W * i) / 6, H);
    ctx.stroke();
  }

  // 距離目盛り
  ctx.fillStyle = "rgba(148,163,184,0.45)";
  ctx.font = "11px ui-monospace, monospace";
  for (const m of [2, 4, 6, 8]) {
    const { sy } = project(0.5, m, W, H);
    ctx.fillText(`${m}m`, 12, sy - 4);
  }

  // 足元のグロー（自機の位置）
  const glow = ctx.createRadialGradient(cx, H, 0, cx, H, W * 0.32);
  glow.addColorStop(0, "rgba(56,189,248,0.10)");
  glow.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, horizon, W, H - horizon);

  // 追従
  const active = tracker?.getActive() ?? [];
  const alive = new Set<string>();
  const k = 1 - Math.exp(-SMOOTH * dt);

  for (const v of active) {
    const cur = v.positions[v.positions.length - 1];
    const d = v.d ?? v.dRaw ?? cur?.d ?? null;
    if (!cur || d === null) continue;

    alive.add(v.id);
    const t = project(cur.x, d, W, H);
    const prev = rendered.get(v.id);
    rendered.set(
      v.id,
      prev
        ? {
            sx: prev.sx + (t.sx - prev.sx) * k,
            sy: prev.sy + (t.sy - prev.sy) * k,
            h: prev.h + (t.h - prev.h) * k,
            d: prev.d + (d - prev.d) * k,
            x: prev.x + (cur.x - prev.x) * k,
          }
        : { ...t, d, x: cur.x }
    );
  }
  for (const id of rendered.keys()) if (!alive.has(id)) rendered.delete(id);

  // 奥から手前へ
  for (const p of [...rendered.values()].sort((a, b) => b.d - a.d)) drawPerson(ctx, p);
}

function drawPerson(ctx: CanvasRenderingContext2D, p: Projected) {
  const { sx, sy, h } = p;
  if (h <= 0) return;
  const w = h * 0.32;

  // 近すぎる相手は薄く（画面外に消える代わり）
  const alpha = Math.min(1, Math.max(0.15, (p.d - D_NEAR) / 0.6));

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
