import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type {
  SessionEvent,
  SessionMetadata,
  ConnectionState,
  ModelInfo,
} from "@github/copilot-sdk";
import type {
  CopilotMessage,
  CopilotHqToolName,
  SessionType,
} from "../../shared/protocol.js";
import { CopilotSessionAggregator } from "./aggregator.js";
import { getTracer, isTracingEnabled } from "../observability/tracing.js";
import { SpanStatusCode } from "@opentelemetry/api";
import { sanitizeForSpan } from "../observability/sanitize.js";

declare module "fastify" {
  interface FastifyInstance {
    copilotAggregator: CopilotSessionAggregator;
  }
}

async function copilotAggregatorPlugin(fastify: FastifyInstance) {
  const aggregator = new CopilotSessionAggregator();
  const registry = fastify.daemonRegistry;

  // Map toolCallId → subagent display name, so assistant.message events from
  // subagents can be persisted with the agent name even after the subagent
  // has been removed from the active list.
  const subagentNamesByToolCallId = new Map<string, string>();
  // Track the currently selected main agent name per session (from subagent.selected)
  const mainAgentNameBySession = new Map<string, string>();

  // ── Daemon disconnect → clean up sessions ─────────────
  registry.on("daemon:disconnected", (summary) => {
    aggregator.removeDaemon(summary.daemonId);
  });

  // ── Daemon copilot message routing ────────────────────
  // Events emitted by DaemonWsHandler.routeMessage() with signature (daemonId, payload)

  registry.on("copilot:session-list", (daemonId, payload) => {
    aggregator.updateSessions(daemonId ?? "", payload.projectId, payload.sessions as SessionMetadata[]);

    // Resolve any pending request-response (e.g. from the resume-picker endpoint)
    if (payload.requestId) {
      aggregator.resolveRequest(payload.requestId, { sessions: payload.sessions as SessionMetadata[] });
    }
  });

  registry.on("copilot:session-event", (daemonId, payload) => {
    const event = payload.event as SessionEvent;
    const sessionType = payload.sessionType as SessionType | undefined;

    // Trace each session event processing
    const doProcess = () => {
    aggregator.handleSessionEvent(daemonId ?? "", payload.sessionId, event);

    // Track session type if provided
    if (sessionType) {
      aggregator.setSessionType(payload.sessionId, sessionType);
    }

    // Track subagent display names so we can enrich persisted messages
    if (event.type === "subagent.started") {
      const d = event.data as { toolCallId?: string; agentDisplayName?: string; agentName?: string };
      if (d.toolCallId) {
        subagentNamesByToolCallId.set(d.toolCallId, d.agentDisplayName ?? d.agentName ?? "subagent");
      }
    }

    // Track the selected main agent name
    if (event.type === "subagent.selected") {
      const d = event.data as { agentDisplayName?: string; agentName?: string };
      mainAgentNameBySession.set(payload.sessionId, d.agentDisplayName ?? d.agentName ?? "");
    }
    if (event.type === "subagent.deselected") {
      mainAgentNameBySession.delete(payload.sessionId);
    }

    // Persist assistant messages to conversation history so they survive refresh
    if (event.type === "assistant.message") {
      const data = event.data as {
        content?: string;
        parentToolCallId?: string;
        model?: string;
        initiator?: string;
      };
      const content = data.content?.trim();
      if (content) {
        const metadata: Record<string, string> = {};
        if (data.parentToolCallId) {
          metadata.parentToolCallId = data.parentToolCallId;
          const subName = subagentNamesByToolCallId.get(data.parentToolCallId);
          if (subName) metadata.subagentName = subName;
        } else {
          // Main agent message — attach the agent display name if one is selected
          const agentName = mainAgentNameBySession.get(payload.sessionId);
          if (agentName) metadata.agentName = agentName;
        }
        if (data.model) metadata.model = data.model;
        if (data.initiator) metadata.initiator = data.initiator;

        aggregator.appendMessages(payload.sessionId, [{
          role: "assistant",
          content,
          timestamp: new Date(event.timestamp).getTime(),
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        }]);
      }
    }

    // Permanently delete corrupted/incompatible sessions from the SDK
    if (event.type === "session.error") {
      const errMsg = String((event.data as Record<string, unknown>)?.message ?? "");
      if (errMsg.includes("corrupted") || errMsg.includes("incompatible")) {
        fastify.log.warn(`Deleting corrupted SDK session ${payload.sessionId}: ${errMsg}`);
        registry.sendToDaemon(daemonId ?? "", {
          type: "copilot-delete-session",
          timestamp: Date.now(),
          payload: { sessionId: payload.sessionId },
        });
      }
    }

    // If the event carries a requestId, resolve any pending request-response
    const requestId = (event as SessionEvent & { data?: Record<string, unknown> })?.data?.requestId;
    if (requestId && typeof requestId === "string") {
      aggregator.resolveRequest(requestId, { sessionId: payload.sessionId });
    }
    };

    if (isTracingEnabled()) {
      // Use active context (propagated from daemon-ws-handler via context.with)
      const span = getTracer("copilot-aggregator").startSpan(`copilot:session-event:${event.type}`, {
        attributes: {
          "copilot.sessionId": payload.sessionId,
          "copilot.event.type": event.type,
          "copilot.daemonId": daemonId ?? "unknown",
          ...(sessionType ? { "copilot.sessionType": sessionType } : {}),
        },
      });

      // Attach the SDK event data as a span event
      span.addEvent("copilot.session.event", sanitizeForSpan(event));

      try {
        doProcess();
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
        throw err;
      } finally {
        span.end();
      }
    } else {
      doProcess();
    }
  });

  registry.on("copilot:sdk-state", (daemonId, payload) => {
    aggregator.handleSdkStateChange(daemonId ?? "", payload.state as ConnectionState, payload.error);
  });

  registry.on("copilot:conversation", (_projectId, payload) => {
    aggregator.appendMessages(payload.sessionId, payload.messages as CopilotMessage[]);
  });

  registry.on("copilot:tool-invocation", (_daemonId, payload) => {
    aggregator.handleToolInvocation(
      payload.sessionId,
      payload.projectId,
      payload.tool as CopilotHqToolName,
      payload.args as Record<string, unknown>,
      payload.timestamp,
    );
  });

  // ── Request-response handlers (resolve pending REST requests) ──

  registry.on("copilot:models-list", (_daemonId, payload) => {
    if (payload.requestId) {
      aggregator.resolveRequest(payload.requestId, { models: payload.models as ModelInfo[] });
    }
  });

  registry.on("copilot:mode-response", (_daemonId, payload) => {
    aggregator.resolveRequest(payload.requestId, { mode: payload.mode });
  });

  registry.on("copilot:agent-response", (_daemonId, payload) => {
    aggregator.resolveRequest(payload.requestId, {
      sessionId: payload.sessionId,
      agentId: payload.agentId,
      agentName: payload.agentName,
      ...(payload.error ? { error: payload.error } : {}),
    });
  });

  registry.on("copilot:plan-response", (_daemonId, payload) => {
    aggregator.resolveRequest(payload.requestId, { plan: payload.plan });
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

  aggregator.on("tool-invocation", (record) => {
    fastify.ws.broadcast("copilot", {
      type: "copilot:tool-invocation",
      ...record,
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
