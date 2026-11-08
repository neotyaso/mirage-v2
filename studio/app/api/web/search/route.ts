import { NextResponse } from "next/server";
import { webSearch } from "@/lib/webSearch";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ error: "q is required" }, { status: 400 });

  try {
    return NextResponse.json({ query, results: await webSearch(query) });
  } catch (e) {
    console.error("[web/search]", e);
    return NextResponse.json({ error: "search unavailable" }, { status: 503 });
  }
}
