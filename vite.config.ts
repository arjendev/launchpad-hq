import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:4321",
        changeOrigin: true,
      },
      "/preview": {
        target: "http://localhost:4321",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:4321",
        ws: true,
      },
    },
  },
});
