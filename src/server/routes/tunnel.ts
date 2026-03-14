// ────────────────────────────────────────────────────────
// Fastify plugin — tunnel management routes + QR code
// ────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import QRCode from "qrcode";
import { TunnelManager } from "../tunnel.js";
import type { TunnelState } from "../tunnel.js";

declare module "fastify" {
  interface FastifyInstance {
    tunnelManager: TunnelManager;
  }
}

async function tunnelPlugin(fastify: FastifyInstance) {
  const manager = new TunnelManager();

  // Broadcast tunnel state changes to WS clients
  manager.on("status-change", () => {
    const state = manager.getState();
    fastify.ws.broadcast("tunnel", {
      type: "tunnel:status",
      ...state,
    });
  });

  fastify.decorate("tunnelManager", manager);

  // Clean up on shutdown
  fastify.addHook("onClose", async () => {
    if (manager.getStatus() !== "stopped") {
      await manager.stop().catch(() => {});
    }
    manager.removeAllListeners();
  });

  // ── REST endpoints ──────────────────────────────────

  /** GET /api/tunnel — current tunnel state (never throws) */
  fastify.get("/api/tunnel", async () => {
    try {
      return manager.getState();
    } catch {
      return {
        status: "stopped",
        info: null,
        shareUrl: null,
        error: null,
      } satisfies TunnelState;
    }
  });

  /** POST /api/tunnel/start — start the tunnel */
  fastify.post<{ Body: { port?: number } }>("/api/tunnel/start", async (request, reply) => {
    const currentStatus = manager.getStatus();
    if (currentStatus === "running") {
      return manager.getState();
    }

    const body = request.body as { port?: number } | undefined;
    const addr = fastify.server.address();
    const serverPort = typeof addr === "object" && addr ? addr.port : 3000;
    const resolvedPort = body?.port ?? serverPort;

    try {
      await manager.start(resolvedPort);
      return manager.getState();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start tunnel";
      return reply.status(500).send({
        error: "tunnel_start_failed",
        message,
        ...manager.getState(),
      });
    }
  });

  /** POST /api/tunnel/stop — stop the tunnel */
  fastify.post("/api/tunnel/stop", async (_request, reply) => {
    try {
      await manager.stop();
      return manager.getState();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stop tunnel";
      return reply.status(500).send({
        error: "tunnel_stop_failed",
        message,
        ...manager.getState(),
      });
    }
  });

  /** GET /api/tunnel/qr — QR code data URI for the share URL */
  fastify.get("/api/tunnel/qr", async (_request, reply) => {
    const shareUrl = manager.getShareUrl();
    if (!shareUrl) {
      return reply.status(404).send({
        error: "no_share_url",
        message: "Tunnel is not running or share URL is not available",
      });
    }

    try {
      const qrDataUrl = await QRCode.toDataURL(shareUrl);
      return { shareUrl, qrDataUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : "QR generation failed";
      return reply.status(500).send({
        error: "qr_generation_failed",
        message,
      });
    }
  });
}

export default fp(tunnelPlugin, {
  name: "tunnel",
  dependencies: ["websocket"],
});
