import { useEffect } from "react";
import type { RefObject } from "react";

const POLL_MS = 800;

function waitIce(pc: RTCPeerConnection) {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, 1500);
  });
}

/**
 * Mirage 側の送信。Studio /vision が置いた offer を取りに行き、カメラの映像トラックで answer を返す。
 * 映像は P2P（WebRTC）。視聴者がいなければ 800ms ごとに空振りするだけ。
 */
export function useVisionRtcSender(
  enabled: boolean,
  videoRef: RefObject<HTMLVideoElement | null>,
) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let pc: RTCPeerConnection | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const closePc = () => {
      if (pc) {
        pc.close();
        pc = null;
      }
    };

    async function step() {
      if (stopped) return;
      const stream = videoRef.current?.srcObject as MediaStream | null;
      if (!stream || stream.getVideoTracks().length === 0) return;

      const res = await fetch("/studio/api/vision/rtc/offer", { cache: "no-store" });
      if (res.status === 204 || !res.ok) return;
      const { id, sdp } = (await res.json()) as { id: string; sdp: string };
      if (stopped) return;

      // 新しい視聴者が来たら既存の接続を閉じて切り替える（最後に開いた /vision を優先）
      closePc();
      const local = new RTCPeerConnection({ iceServers: [] });
      pc = local;
      for (const track of stream.getVideoTracks()) local.addTrack(track, stream);

      await local.setRemoteDescription({ type: "offer", sdp });
      await local.setLocalDescription(await local.createAnswer());
      await waitIce(local);
      if (stopped || pc !== local) return;

      await fetch("/studio/api/vision/rtc/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, sdp: local.localDescription?.sdp }),
      });
    }

    async function loop() {
      try {
        await step();
      } catch {
        // 次のポーリングで再試行（Studio未起動でも展示側は止めない）
      }
      if (!stopped) timer = setTimeout(loop, POLL_MS);
    }

    void loop();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      closePc();
    };
  }, [enabled, videoRef]);
}
