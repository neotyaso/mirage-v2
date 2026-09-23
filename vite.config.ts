import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
    },
  },
});
