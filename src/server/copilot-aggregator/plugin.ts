import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type {
  CopilotSessionInfo,
  CopilotSessionEvent,
  CopilotSdkState,
  CopilotMessage,
} from "../../shared/protocol.js";
import { CopilotSessionAggregator } from "./aggregator.js";

declare module "fastify" {
  interface FastifyInstance {
    copilotAggregator: CopilotSessionAggregator;
  }
}

async function copilotAggregatorPlugin(fastify: FastifyInstance) {
  const aggregator = new CopilotSessionAggregator();
  const registry = fastify.daemonRegistry;

  // ── Daemon disconnect → clean up sessions ─────────────
  registry.on("daemon:disconnected", (summary) => {
    aggregator.removeDaemon(summary.daemonId);
  });

  // ── Daemon copilot message routing ────────────────────
  // Events emitted by DaemonWsHandler.routeMessage() with signature (daemonId, payload)
  // Note: daemonId === projectId in this codebase (see handler register case)

  registry.on("copilot:session-update" as never, (daemonId: string, payload: { projectId: string; session: CopilotSessionInfo }) => {
    aggregator.updateSessions(daemonId, payload.projectId, [payload.session]);
  });

  registry.on("copilot:session-list" as never, (daemonId: string, payload: { projectId: string; sessions: CopilotSessionInfo[] }) => {
    aggregator.updateSessions(daemonId, payload.projectId, payload.sessions);
  });

  registry.on("copilot:session-event" as never, (daemonId: string, payload: { projectId: string; sessionId: string; event: CopilotSessionEvent }) => {
    aggregator.handleSessionEvent(daemonId, payload.sessionId, payload.event);
  });

  registry.on("copilot:sdk-state" as never, (daemonId: string, payload: { projectId: string; state: CopilotSdkState; error?: string }) => {
    aggregator.handleSdkStateChange(daemonId, payload.state, payload.error);
  });

  registry.on("copilot:conversation" as never, (_daemonId: string, payload: { sessionId: string; messages: CopilotMessage[] }) => {
    aggregator.appendMessages(payload.sessionId, payload.messages);
  });

  // ── Broadcast aggregator events to browser clients ────
  aggregator.on("sessions-updated", (sessions) => {
    fastify.ws.broadcast("copilot", {
      type: "copilot:sessions-updated",
      sessions,
    });
  });

  aggregator.on("session-event", (sessionId, event) => {
    fastify.ws.broadcast("copilot", {
      type: "copilot:session-event",
      sessionId,
      event,
    });
  });

  aggregator.on("sdk-state-changed", (daemonId, state) => {
    fastify.ws.broadcast("copilot", {
      type: "copilot:sdk-state-changed",
      daemonId,
      state,
    });
  });

  // ── Decorate ──────────────────────────────────────────
  fastify.decorate("copilotAggregator", aggregator);

  fastify.addHook("onClose", () => {
    aggregator.removeAllListeners();
  });
}

export default fp(copilotAggregatorPlugin, {
  name: "copilot-aggregator",
  dependencies: ["websocket", "daemon-registry"],
});
