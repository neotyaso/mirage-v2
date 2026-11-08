"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";

export type RtcStatus = "connecting" | "connected" | "failed";

const ANSWER_POLL_MS = 250;
const ANSWER_TIMEOUT_MS = 20_000;
const RETRY_MS = 2000;

function apiUrl(path: string) {
  return typeof location !== "undefined" && location.pathname.startsWith("/studio")
    ? `/studio${path}`
    : path;
}

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
 * Studio /vision 側の受信。offer を作ってメールボックスに置き、Mirage の answer を待つ。
 * 映像は P2P（WebRTC）。接続できないときは /vision 側の JPEG フォールバックが残る。
 */
export function useVisionRtcReceiver(videoRef: RefObject<HTMLVideoElement | null>) {
  const [status, setStatus] = useState<RtcStatus>("connecting");

  useEffect(() => {
    let stopped = false;
    let runId = 0;
    let pc: RTCPeerConnection | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const clearPoll = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const closePc = () => {
      clearPoll();
      if (pc) {
        pc.onconnectionstatechange = null;
        pc.ontrack = null;
        pc.close();
        pc = null;
      }
    };

    function retryLater(my: number) {
      if (stopped || my !== runId) return;
      closePc();
      setStatus("failed");
      setTimeout(() => {
        if (!stopped) void connect();
      }, RETRY_MS);
    }

    async function connect() {
      const my = ++runId;
      closePc();
      setStatus("connecting");

      try {
        const local = new RTCPeerConnection({ iceServers: [] });
        pc = local;

        local.ontrack = (e) => {
          if (my !== runId) return;
          const video = videoRef.current;
          if (!video) return;
          const stream = e.streams[0] ?? new MediaStream([e.track]);
          if (video.srcObject !== stream) video.srcObject = stream;
          void video.play().catch(() => {});
          setStatus("connected");
        };

        local.onconnectionstatechange = () => {
          if (my !== runId) return;
          if (local.connectionState === "failed" || local.connectionState === "closed") {
            retryLater(my);
          } else if (local.connectionState === "disconnected") {
            // 一時的な切断は自然復帰することがあるので少し待ってから諦める
            setTimeout(() => {
              if (!stopped && my === runId && local.connectionState !== "connected") {
                retryLater(my);
              }
            }, 4000);
          }
        };

        local.addTransceiver("video", { direction: "recvonly" });
        await local.setLocalDescription(await local.createOffer());
        await waitIce(local);
        if (stopped || my !== runId) return;

        const res = await fetch(apiUrl("/api/vision/rtc/offer"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp: local.localDescription?.sdp }),
        });
        if (!res.ok) throw new Error(`offer failed: ${res.status}`);
        const { id } = (await res.json()) as { id: string };
        if (stopped || my !== runId) return;

        const startedAt = Date.now();
        pollTimer = setInterval(async () => {
          if (stopped || my !== runId) return;
          if (Date.now() - startedAt > ANSWER_TIMEOUT_MS) {
            retryLater(my);
            return;
          }
          try {
            const answerRes = await fetch(
              apiUrl(`/api/vision/rtc/answer?id=${encodeURIComponent(id)}`),
              { cache: "no-store" },
            );
            if (answerRes.status === 204) return;
            if (!answerRes.ok) throw new Error(`answer failed: ${answerRes.status}`);
            const { sdp } = (await answerRes.json()) as { sdp: string };
            if (stopped || my !== runId) return;
            clearPoll();
            await local.setRemoteDescription({ type: "answer", sdp });
          } catch {
            // 1回の失敗は無視して次のポーリングへ（タイムアウトで再接続）
          }
        }, ANSWER_POLL_MS);
      } catch {
        retryLater(my);
      }
    }

    void connect();

    return () => {
      stopped = true;
      runId++;
      closePc();
    };
  }, [videoRef]);

  return status;
}
