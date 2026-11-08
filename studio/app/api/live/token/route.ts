import { NextResponse } from "next/server";

// Gemini Live 用の短命トークンを発行する（D-018）。
// APIキーはサーバーに置いたまま、ブラウザには30分で切れるトークンだけ渡す。
// preview 機能のため、失敗時はクライアントが明示エラーにする（黙って諦めない）。

export const dynamic = "force-dynamic";

const URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";

export async function POST() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "GEMINI_API_KEY 未設定 (studio/.env)" }, { status: 503 });
  }
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`auth_tokens ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { name?: string };
    if (!data.name) throw new Error("auth_tokens: name なし");
    return NextResponse.json({ token: data.name });
  } catch (e) {
    console.error("[live/token]", e);
    return NextResponse.json({ error: "token unavailable" }, { status: 503 });
  }
}
