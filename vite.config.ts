import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        dance: "dance.html",
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    // 展示端末のURLを固定する。使用中なら別ポートへ逃げず、明確に失敗させる。
    strictPort: true,
    proxy: {
      // ローカルLLMフォールバック（Ollama）
      "/ollama": {
        target: "http://localhost:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ""),
      },
      // Studio（検索・本文取得の API 中継。D-017）
      "/studio": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/studio/, ""),
      },
    },
  },
});
