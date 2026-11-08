import { NextResponse } from "next/server";
import { claimOffer, createSession } from "@/lib/visionRtc";

// 受信側（/vision）が offer を置き、送信側（Mirage）が取りに来る。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { sdp?: unknown } | null;
  if (typeof body?.sdp !== "string" || body.sdp.length < 20 || body.sdp.length > 20_000) {
    return NextResponse.json({ error: "invalid sdp" }, { status: 400 });
  }
  const session = createSession(body.sdp);
  return NextResponse.json({ id: session.id });
}

export async function GET() {
  const session = claimOffer();
  if (!session) return new Response(null, { status: 204 });
  return NextResponse.json(
    { id: session.id, sdp: session.offer },
    { headers: { "Cache-Control": "no-store" } },
  );
}
