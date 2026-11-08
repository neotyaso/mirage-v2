import { NextResponse } from "next/server";
import { getAnswer, setAnswer } from "@/lib/visionRtc";

// 送信側（Mirage）が answer を置き、受信側（/vision）が取りに来る。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { id?: unknown; sdp?: unknown }
    | null;
  if (
    typeof body?.id !== "string" ||
    typeof body.sdp !== "string" ||
    body.sdp.length < 20 ||
    body.sdp.length > 20_000
  ) {
    return NextResponse.json({ error: "invalid answer" }, { status: 400 });
  }
  if (!setAnswer(body.id, body.sdp)) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const sdp = getAnswer(id);
  if (!sdp) return new Response(null, { status: 204 });
  return NextResponse.json({ sdp }, { headers: { "Cache-Control": "no-store" } });
}
