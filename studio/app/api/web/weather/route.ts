import { NextResponse } from "next/server";
import { getWeather } from "@/lib/weather";

export async function GET() {
  try {
    return NextResponse.json(await getWeather());
  } catch (e) {
    console.error("[web/weather]", e);
    return NextResponse.json({ error: "weather unavailable" }, { status: 503 });
  }
}
