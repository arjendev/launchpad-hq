// ────────────────────────────────────────────────────────
// Fastify plugin — Copilot session introspection
//
// Registers:
//   - CopilotSessionManager as fastify.copilot
//   - GET /api/copilot/sessions — list active sessions
//   - GET /api/copilot/sessions/:id — session details
//   - WebSocket broadcasts on the "copilot" channel
// ────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { CopilotSessionManager } from "./session-manager.js";
import { MockCopilotAdapter } from "./mock-adapter.js";
import type { CopilotSession, CopilotSessionSummary } from "./types.js";

declare module "fastify" {
  interface FastifyInstance {
    copilot: CopilotSessionManager;
  }
}

export interface CopilotPluginOptions {
  /** Set to false to disable the mock adapter (e.g. when a real SDK is available). */
  mock?: boolean;
  /** Interval (ms) for mock session change simulation. Default 30 000. */
  mockUpdateIntervalMs?: number;
}

async function copilotPlugin(
  fastify: FastifyInstance,
  opts: CopilotPluginOptions,
) {
  const useMock = opts.mock ?? true; // default to mock until real SDK exists

  // ── Adapter selection ────────────────────────────────
  // EXTENSION POINT: When a real Copilot SDK ships, add
  // an SdkCopilotAdapter and select it here based on opts.
  const adapter = useMock
    ? new MockCopilotAdapter({
        updateIntervalMs: opts.mockUpdateIntervalMs ?? 30_000,
      })
    : new MockCopilotAdapter({ updateIntervalMs: 0 }); // placeholder — swap for real SDK

  const manager = new CopilotSessionManager({
    adapter,
    onSessionChange: (event) => {
      // Push to all WebSocket clients subscribed to "copilot"
      fastify.ws.broadcast("copilot", event);
    },
  });

  fastify.decorate("copilot", manager);

  // Start watching for session changes
  manager.startWatching();

  // Clean up on server close
  fastify.addHook("onClose", () => {
    manager.dispose();
  });

  // ── REST endpoints ───────────────────────────────────

  fastify.get<{
    Reply: { sessions: CopilotSessionSummary[]; count: number; adapter: string };
  }>("/api/copilot/sessions", async () => {
    const sessions = await manager.listSessions();
    return {
      sessions,
      count: sessions.length,
      adapter: useMock ? "mock" : "sdk",
    };
  });

  fastify.get<{
    Params: { id: string };
    Reply: CopilotSession | { error: string };
  }>("/api/copilot/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await manager.getSession(id);

    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    return session;
  });
}

export default fp(copilotPlugin, {
  name: "copilot-introspection",
  dependencies: ["websocket"],
});
