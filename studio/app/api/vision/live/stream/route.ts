import { getVision, subscribeVision } from "@/lib/visionLive";

// /vision への即時プッシュ（Server-Sent Events）。
// POST /api/vision/live が来た瞬間に1件ずつ流す。ポーリング待ちがない。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;

export async function GET() {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (v: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(v)}\n\n`));
        } catch {
          /* 切断済み */
        }
      };

      const current = getVision();
      if (current) send(current);

      unsubscribe = subscribeVision(send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* 切断済み */
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
