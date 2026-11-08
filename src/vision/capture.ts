// カメラ映像の現在フレームを小さいJPEGのデータURLにする。
// 小さめ(既定240px)なのは送受信を軽くするためとプライバシー配慮の両方。
// videoがまだ再生準備前(readyState<2)やサイズ0なら撮れないのでnull。
export function captureFrame(video: HTMLVideoElement, maxW = 240, quality = 0.7): string | null {
  if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
  const scale = Math.min(1, maxW / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}
