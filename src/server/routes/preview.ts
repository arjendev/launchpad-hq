// ────────────────────────────────────────────────────────
// Fastify plugin — preview proxy routes
//
// Proxies HTTP (and later WS) requests through the daemon
// WebSocket to the project's local dev server.
//
// Proxy chain:
//   Phone → DevTunnel → HQ Fastify → daemon WS → localhost:previewPort → back
// ────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import QRCode from "qrcode";
import type {
  PreviewProxyRequestMessage,
  PreviewProxyResponseMessage,
  PreviewWsOpenMessage,
  PreviewWsDataMessage,
  PreviewWsCloseMessage,
} from "../../shared/protocol.js";

// ── Pending request tracking ─────────────────────────────

interface PendingRequest {
  resolve: (response: PreviewProxyResponseMessage["payload"]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const PROXY_TIMEOUT_MS = 30_000;

/** Map of requestId → pending promise resolver. Shared with handler.ts via exported function. */
const pendingRequests = new Map<string, PendingRequest>();

/**
 * Resolve a pending preview proxy response (called from handler.ts
 * when a `preview-proxy-response` message arrives from a daemon).
 */
export function resolvePreviewResponse(
  requestId: string,
  response: PreviewProxyResponseMessage["payload"],
): void {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  pending.resolve(response);
}

// ── WS relay channel tracking (Phase 3) ──────────────────

interface WsChannel {
  browserWs: import("ws").WebSocket;
  daemonId: string;
}

const wsChannels = new Map<string, WsChannel>();

/**
 * Forward WS data from daemon to browser client (Phase 3).
 * Called from handler.ts on `preview-ws-data`.
 */
export function forwardPreviewWsData(channelId: string, data: string): void {
  const channel = wsChannels.get(channelId);
  if (!channel) return;
  try {
    channel.browserWs.send(Buffer.from(data, "base64"));
  } catch {
    /* client may have disconnected */
  }
}

/**
 * Close a WS channel from daemon side (Phase 3).
 * Called from handler.ts on `preview-ws-close`.
 */
export function closePreviewWsChannel(channelId: string, code?: number, reason?: string): void {
  const channel = wsChannels.get(channelId);
  if (!channel) return;
  wsChannels.delete(channelId);
  try {
    channel.browserWs.close(code ?? 1000, reason ?? "");
  } catch {
    /* already closed */
  }
}

// ── Security: port validation (M1) ───────────────────────

/** Ports that must never be proxied — infrastructure services only. */
const BLOCKED_PREVIEW_PORTS = new Set([
  22,    // SSH
  25,    // SMTP
  53,    // DNS
  111,   // rpcbind
  135,   // MSRPC
  139,   // NetBIOS
  445,   // SMB
  1433,  // MSSQL
  1521,  // Oracle DB
  3306,  // MySQL
  5432,  // PostgreSQL
  6379,  // Redis
  9200,  // Elasticsearch
  27017, // MongoDB
]);

/** Returns true if the port is valid for preview proxying. */
function isValidPreviewPort(port: number): boolean {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return false;
  if (BLOCKED_PREVIEW_PORTS.has(port)) return false;
  return true;
}

// ── Plugin ───────────────────────────────────────────────

async function previewPlugin(fastify: FastifyInstance) {
  const registry = fastify.daemonRegistry;

  // Wire up registry events for preview responses and WS relay
  registry.on("preview:proxy-response" as never, (payload: PreviewProxyResponseMessage["payload"]) => {
    resolvePreviewResponse(payload.requestId, payload);
  });

  registry.on("preview:ws-data" as never, (payload: PreviewWsDataMessage["payload"]) => {
    forwardPreviewWsData(payload.channelId, payload.data);
  });

  registry.on("preview:ws-close" as never, (payload: PreviewWsCloseMessage["payload"]) => {
    closePreviewWsChannel(payload.channelId, payload.code, payload.reason);
  });

  // Clean up on shutdown
  fastify.addHook("onClose", () => {
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Server shutting down"));
      pendingRequests.delete(id);
    }
    for (const [id, channel] of wsChannels) {
      try { channel.browserWs.close(1001, "Server shutting down"); } catch { /* */ }
      wsChannels.delete(id);
    }
  });

  // ── REST API ─────────────────────────────────────────

  /** GET /api/preview — list all daemons with preview configured */
  fastify.get("/api/preview", async () => {
    const daemons = registry.getAllDaemons();
    return daemons
      .filter((d) => d.previewPort !== undefined)
      .map((d) => ({
        projectId: d.projectId,
        port: d.previewPort,
        autoDetected: d.previewAutoDetected,
        detectedFrom: d.previewDetectedFrom,
        state: d.state,
      }));
  });

  /** GET /api/preview/:projectId — preview state for a specific project */
  fastify.get<{ Params: { projectId: string } }>(
    "/api/preview/:projectId",
    async (request, reply) => {
      const projectId = decodeURIComponent(request.params.projectId);
      const daemon = registry.findDaemonByProjectId(projectId);
      if (!daemon) {
        return reply.status(404).send({
          error: "not_found",
          message: "Project not connected",
        });
      }
      return {
        projectId: daemon.info.projectId,
        port: daemon.previewPort,
        autoDetected: daemon.previewAutoDetected,
        detectedFrom: daemon.previewDetectedFrom,
        state: daemon.state,
        connected: daemon.state === "connected",
        hasPreview: daemon.previewPort !== undefined,
      };
    },
  );

  /** GET /api/preview/:projectId/qr — QR code for preview URL */
  fastify.get<{ Params: { projectId: string } }>(
    "/api/preview/:projectId/qr",
    async (request, reply) => {
      const projectId = decodeURIComponent(request.params.projectId);
      const daemon = registry.findDaemonByProjectId(projectId);
      if (!daemon || !daemon.previewPort) {
        return reply.status(404).send({
          error: "no_preview",
          message: "Project not connected or no preview configured",
        });
      }

      // Build preview URL from tunnel share URL if available
      const shareUrl = fastify.tunnelManager?.getShareUrl?.();
      if (!shareUrl) {
        return reply.status(404).send({
          error: "no_tunnel",
          message: "Tunnel is not running — no shareable preview URL",
        });
      }

      const previewUrl = `${shareUrl}/preview/${encodeURIComponent(projectId)}/`;
      try {
        const qrDataUrl = await QRCode.toDataURL(previewUrl);
        return { previewUrl, qrDataUrl };
      } catch (err) {
        const message = err instanceof Error ? err.message : "QR generation failed";
        return reply.status(500).send({ error: "qr_generation_failed", message });
      }
    },
  );

  // ── Preview controls (Phase 3) ────────────────────────

  /** POST /api/preview/:projectId/start — tell daemon to start preview */
  fastify.post<{ Params: { projectId: string }; Body: { port?: number } }>(
    "/api/preview/:projectId/start",
    async (request, reply) => {
      const projectId = decodeURIComponent(request.params.projectId);
      const daemon = registry.findDaemonByProjectId(projectId);
      if (!daemon) {
        return reply.status(404).send({
          error: "not_found",
          message: "Project not connected",
        });
      }
      const body = request.body as { port?: number } | undefined;
      if (body?.port !== undefined && !isValidPreviewPort(body.port)) {
        return reply.status(400).send({
          error: "bad_request",
          message: "port must be an integer between 1024 and 65535, and not a well-known infrastructure port",
        });
      }
      const sent = registry.sendToDaemon(daemon.daemonId, {
        type: "command",
        timestamp: Date.now(),
        payload: {
          projectId,
          action: "start-preview" as never,
          args: body?.port ? { port: body.port } : undefined,
        },
      });
      if (!sent) {
        return reply.status(503).send({
          error: "daemon_unavailable",
          message: "Daemon is not connected",
        });
      }
      return { ok: true, projectId };
    },
  );

  /** POST /api/preview/:projectId/stop — tell daemon to stop preview */
  fastify.post<{ Params: { projectId: string } }>(
    "/api/preview/:projectId/stop",
    async (request, reply) => {
      const projectId = decodeURIComponent(request.params.projectId);
      const daemon = registry.findDaemonByProjectId(projectId);
      if (!daemon) {
        return reply.status(404).send({
          error: "not_found",
          message: "Project not connected",
        });
      }
      const sent = registry.sendToDaemon(daemon.daemonId, {
        type: "command",
        timestamp: Date.now(),
        payload: {
          projectId,
          action: "stop-preview" as never,
        },
      });
      if (!sent) {
        return reply.status(503).send({
          error: "daemon_unavailable",
          message: "Daemon is not connected",
        });
      }
      return { ok: true, projectId };
    },
  );

  // ── Wildcard proxy route ─────────────────────────────

  /**
   * ALL /preview/:projectId/* — proxy HTTP requests through daemon WS
   *
   * Handles all HTTP methods. Encodes request body as base64,
   * sends a preview-proxy-request to the daemon, and waits for
   * the preview-proxy-response.
   */
  fastify.all<{ Params: { projectId: string; "*": string } }>(
    "/preview/:projectId/*",
    async (request: FastifyRequest<{ Params: { projectId: string; "*": string } }>, reply: FastifyReply) => {
      const projectId = decodeURIComponent(request.params.projectId);
      const daemon = registry.findDaemonByProjectId(projectId);

      if (!daemon || daemon.state !== "connected") {
        return reply.status(503).send({
          error: "not_connected",
          message: "Project not connected",
        });
      }

      if (!daemon.previewPort) {
        return reply.status(503).send({
          error: "no_preview",
          message: "No preview configured for this project",
        });
      }

      // M1 — Validate the preview port is in a safe range
      if (!isValidPreviewPort(daemon.previewPort)) {
        return reply.status(403).send({
          error: "forbidden_port",
          message: `Preview port ${daemon.previewPort} is blocked for security reasons`,
        });
      }

      const requestId = randomUUID();
      const rawPath = "/" + (request.params["*"] || "");
      const queryString = request.url.includes("?")
        ? request.url.substring(request.url.indexOf("?"))
        : "";

      // Defense-in-depth path sanitization: reject traversal and null bytes
      const proxyPath = posix.normalize(rawPath);
      if (proxyPath.includes('\0') || proxyPath.startsWith('..')) {
        return reply.status(400).send({
          error: "bad_request",
          message: "Invalid path",
        });
      }

      // Encode body as base64 for binary safety
      let bodyBase64: string | undefined;
      if (request.body) {
        const raw = typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body);
        bodyBase64 = Buffer.from(raw).toString("base64");
      }

      // Build sanitised header map (strip hop-by-hop headers)
      const headers: Record<string, string> = {};
      const hopByHop = new Set([
        "connection", "keep-alive", "proxy-authenticate",
        "proxy-authorization", "te", "trailers",
        "transfer-encoding", "upgrade", "host",
      ]);
      for (const [key, value] of Object.entries(request.headers)) {
        if (!hopByHop.has(key.toLowerCase()) && value) {
          headers[key] = Array.isArray(value) ? value.join(", ") : value;
        }
      }

      const proxyMsg: PreviewProxyRequestMessage = {
        type: "preview-proxy-request",
        timestamp: Date.now(),
        payload: {
          requestId,
          method: request.method,
          path: proxyPath + queryString,
          headers,
          body: bodyBase64,
        },
      };

      // Send to daemon and wait for response
      const sent = registry.sendToDaemon(daemon.daemonId, proxyMsg);
      if (!sent) {
        return reply.status(503).send({
          error: "daemon_unavailable",
          message: "Failed to send request to daemon",
        });
      }

      try {
        const response = await waitForResponse(requestId);

        // Forward response back to client
        const responseHeaders = { ...response.headers };
        // Remove hop-by-hop from response too
        delete responseHeaders["transfer-encoding"];
        delete responseHeaders["connection"];

        return reply
          .status(response.statusCode)
          .headers(responseHeaders)
          .send(Buffer.from(response.body, "base64"));
      } catch (err) {
        if (err instanceof Error && err.message === "Preview proxy timeout") {
          return reply.status(504).send({
            error: "gateway_timeout",
            message: "Preview proxy request timed out after 30s",
          });
        }
        return reply.status(502).send({
          error: "bad_gateway",
          message: err instanceof Error ? err.message : "Preview proxy error",
        });
      }
    },
  );
}

/** Wait for a preview-proxy-response matching the requestId */
function waitForResponse(requestId: string): Promise<PreviewProxyResponseMessage["payload"]> {
  return new Promise<PreviewProxyResponseMessage["payload"]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Preview proxy timeout"));
    }, PROXY_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, reject, timeout });
  });
}

// Exported for testing
export { pendingRequests, wsChannels, PROXY_TIMEOUT_MS, isValidPreviewPort, BLOCKED_PREVIEW_PORTS };

export default fp(previewPlugin, {
  name: "preview",
  dependencies: ["websocket", "daemon-registry", "tunnel"],
});
