import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import http from "node:http";

/**
 * Vite plugin that proxies /preview/* requests to Fastify before any
 * internal middleware can intervene.
 *
 * Without this, Vite's SPA fallback (`htmlFallbackMiddleware`) rewrites
 * browser requests (which send `Accept: text/html`) to /index.html,
 * causing the React SPA + TanStack Router to boot and show "Not Found".
 *
 * By adding middleware in `configureServer` (not in the returned
 * function), we run BEFORE Vite's built-in proxy and SPA fallback.
 */
function previewProxyPlugin(): Plugin {
  return {
    name: "preview-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/preview/")) return next();

        const proxyReq = http.request(
          {
            hostname: "localhost",
            port: 3000,
            path: url,
            method: req.method ?? "GET",
            headers: { ...req.headers, host: "localhost:3000" },
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );

        proxyReq.on("error", (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "preview_proxy_error", message: err.message }));
          }
        });

        req.pipe(proxyReq);
      });
    },
  };
}

export default defineConfig({
  plugins: [previewProxyPlugin(), react()],
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
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
