import { NextResponse } from "next/server";

// 見た目コメント用の画像1枚を Gemini に投げる（D-018）。
// ブラウザに APIキーを置かないため、Vision も Studio 経由にする。

export const dynamic = "force-dynamic";

const MODEL = "gemini-3.5-flash";

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "GEMINI_API_KEY 未設定" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as
    | { image?: string; prompt?: string }
    | null;
  if (!body?.image) return NextResponse.json({ error: "image is required" }, { status: 400 });

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: body.prompt ?? "" },
                { inlineData: { mimeType: "image/jpeg", data: body.image } },
              ],
            },
          ],
          generationConfig: { temperature: 0.9, maxOutputTokens: 60 },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) throw new Error(`generateContent ${res.status}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return NextResponse.json({ text });
  } catch (e) {
    console.error("[vision/comment]", e);
    return NextResponse.json({ error: "vision unavailable" }, { status: 503 });
  }
}
