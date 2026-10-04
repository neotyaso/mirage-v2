import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { VisitorTracker } from "../tracking/visitorTracker";
import { ZONE_FAR_M, ZONE_MID_M } from "../tracking/types";

interface BevMapProps {
  trackerRef: RefObject<VisitorTracker | null>;
  visible: boolean;
}

const MAX_D = 5; // m、表示範囲
const MAX_LAT = 3; // m、左右表示範囲
const W = 200;
const H = 240;

// 正面を上にしない。手前=下（自機位置）、奥=上。テスラ式BEV風。
function toBev(x: number, d: number | null): { px: number; py: number } {
  const depth = d !== null && Number.isFinite(d) ? d : MAX_D;
  const lat = (0.5 - x) * depth * 1.2; // ponytail: FOV固定近似、P3で詰める
  return {
    px: W / 2 + (lat / MAX_LAT) * (W / 2 - 8),
    py: H - 22 - (Math.min(depth, MAX_D) / MAX_D) * (H - 40),
  };
}

// P2俯瞰可視化：人物・軌道のデバッグ用2Dマップ。声かけ用途なし。
export function BevMap({ trackerRef, visible }: BevMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      const canvas = canvasRef.current;
      const tracker = trackerRef.current;
      if (!canvas || !tracker) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const active = tracker.getActive();

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(0, 0, W, H);

      // ゾーン円弧（自機中心）
      const cx = W / 2;
      const cy = H - 22;
      const scale = (H - 40) / MAX_D;
      for (const [m, color] of [[ZONE_MID_M, "#38bdf8"], [ZONE_FAR_M, "#334155"]] as const) {
        ctx.beginPath();
        ctx.arc(cx, cy, m * scale, Math.PI, 0);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = "9px monospace";
        ctx.fillText(`${m}m`, cx + 4, cy - m * scale - 2);
      }

      // 自機▲
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx - 6, cy + 4);
      ctx.lineTo(cx + 6, cy + 4);
      ctx.closePath();
      ctx.fill();

      // 人物＋軌道
      for (const v of active) {
        const cur = v.positions[v.positions.length - 1];
        if (!cur) continue;
        const dCur = v.d ?? v.dRaw ?? cur.d ?? null;
        // 軌道（古いほど薄く）
        ctx.strokeStyle = "rgba(34,197,94,0.5)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (const p of v.positions) {
          const dd = p.d ?? dCur;
          if (dd === undefined) continue;
          const { px, py } = toBev(p.x, dd ?? null);
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        // 現在位置
        const { px, py } = toBev(cur.x, dCur);
        ctx.fillStyle = "#4ade80";
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px monospace";
        ctx.fillText(`${v.id} ${dCur !== null ? dCur.toFixed(1) + "m" : "-"}`, px + 7, py + 3);
      }

      if (active.length === 0) {
        ctx.fillStyle = "#64748b";
        ctx.font = "10px monospace";
        ctx.fillText("no visitors", 12, 20);
      }
    }, 250);
    return () => clearInterval(id);
  }, [visible, trackerRef]);

  if (!visible) return null;
  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ width: W, height: H, borderRadius: 6, border: "1px solid #334155" }}
    />
  );
}
