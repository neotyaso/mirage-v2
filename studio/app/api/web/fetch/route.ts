import { NextResponse } from "next/server";
import { fetchPage } from "@/lib/webFetch";

export async function POST(request: Request) {
  const body: { url?: string } = await request.json().catch(() => ({}));
  const url = body.url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "http(s) url is required" }, { status: 400 });
  }

  try {
    return NextResponse.json({ url, markdown: await fetchPage(url) });
  } catch (e) {
    console.error("[web/fetch]", e);
    return NextResponse.json({ error: "fetch unavailable" }, { status: 503 });
  }
}
