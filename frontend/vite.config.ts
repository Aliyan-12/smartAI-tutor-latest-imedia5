import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    allowedHosts: [".ngrok-free.app", ".ngrok.io"],
    proxy: {
      // WebSocket pipelines need explicit ws:true upgrade entries (the /api
      // catch-all below is HTTP-only and won't upgrade them).
      "/api/chat/ws": {
        target: "ws://localhost:8001",
        ws: true,
      },
      "/api/sessions/ws": {
        target: "ws://localhost:8001",
        ws: true,
      },
      "/api": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
});
