import { NextResponse } from "next/server";
import { getVision, publishVision } from "@/lib/visionLive";

// Mirage のブラウザから送られてくる「カメラ1枚＋表情スコア」の受信口。
// 受け取ったら即座に SSE 購読者（/vision）へ配る。画像は保存しない。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        frame?: string;
        expressions?: { smile?: number; surprised?: number; confused?: number };
        face?: { count?: number; box?: { x: number; y: number; w: number; h: number } | null };
        distanceM?: number | null;
        yaw?: number;
      }
    | null;

  if (!body?.frame || typeof body.frame !== "string") {
    return NextResponse.json({ error: "frame is required" }, { status: 400 });
  }
  if (body.frame.length > 400_000) {
    return NextResponse.json({ error: "frame too large" }, { status: 413 });
  }

  publishVision({
    frame: body.frame,
    expressions: {
      smile: body.expressions?.smile ?? 0,
      surprised: body.expressions?.surprised ?? 0,
      confused: body.expressions?.confused ?? 0,
    },
    face: { count: body.face?.count ?? 0, box: body.face?.box ?? null },
    distanceM: body.distanceM ?? null,
    yaw: body.yaw ?? 0,
    at: Date.now(),
  });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json(getVision() ?? { at: 0 }, {
    headers: { "Cache-Control": "no-store" },
  });
}
