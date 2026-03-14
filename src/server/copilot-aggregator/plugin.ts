import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
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
import type { InboxMessage } from "../state/types.js";
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

  registry.on("copilot:session-list" as never, (daemonId: string, payload: { projectId: string; requestId?: string; sessions: SessionMetadata[] }) => {
    aggregator.updateSessions(daemonId, payload.projectId, payload.sessions);

    // Resolve any pending request-response (e.g. from the resume-picker endpoint)
    if (payload.requestId) {
      aggregator.resolveRequest(payload.requestId, { sessions: payload.sessions });
    }
  });

  registry.on("copilot:session-event" as never, (daemonId: string, payload: { projectId: string; sessionId: string; sessionType?: SessionType; event: SessionEvent }) => {
    aggregator.handleSessionEvent(daemonId, payload.sessionId, payload.event);

    // Track session type if provided
    if (payload.sessionType) {
      aggregator.setSessionType(payload.sessionId, payload.sessionType);
    }

    // Persist assistant messages to conversation history so they survive refresh
    if (payload.event.type === "assistant.message") {
      const data = payload.event.data as { content?: string; parentToolCallId?: string };
      const content = data.content?.trim();
      if (content) {
        aggregator.appendMessages(payload.sessionId, [{
          role: "assistant",
          content,
          timestamp: new Date(payload.event.timestamp).getTime(),
        }]);
      }
    }

    // Permanently delete corrupted/incompatible sessions from the SDK
    if (payload.event.type === "session.error") {
      const errMsg = String((payload.event.data as Record<string, unknown>)?.message ?? "");
      if (errMsg.includes("corrupted") || errMsg.includes("incompatible")) {
        fastify.log.warn(`Deleting corrupted SDK session ${payload.sessionId}: ${errMsg}`);
        registry.sendToDaemon(daemonId, {
          type: "copilot-delete-session",
          timestamp: Date.now(),
          payload: { sessionId: payload.sessionId },
        });
      }
    }

    // If the event carries a requestId, resolve any pending request-response
    const requestId = (payload.event as SessionEvent & { data?: Record<string, unknown> })?.data?.requestId;
    if (requestId && typeof requestId === "string") {
      aggregator.resolveRequest(requestId, { sessionId: payload.sessionId });
    }
  });

  registry.on("copilot:sdk-state" as never, (daemonId: string, payload: { projectId: string; state: ConnectionState; error?: string }) => {
    aggregator.handleSdkStateChange(daemonId, payload.state, payload.error);
  });

  registry.on("copilot:conversation" as never, (_daemonId: string, payload: { sessionId: string; messages: CopilotMessage[] }) => {
    aggregator.appendMessages(payload.sessionId, payload.messages);
  });

  registry.on("copilot:tool-invocation" as never, (_daemonId: string, payload: {
    sessionId: string;
    projectId: string;
    tool: CopilotHqToolName;
    args: Record<string, unknown>;
    timestamp: number;
  }) => {
    aggregator.handleToolInvocation(
      payload.sessionId,
      payload.projectId,
      payload.tool,
      payload.args,
      payload.timestamp,
    );
  });

  // ── Request-response handlers (resolve pending REST requests) ──

  registry.on("copilot:models-list" as never, (_daemonId: string, payload: { requestId?: string; models: ModelInfo[] }) => {
    if (payload.requestId) {
      aggregator.resolveRequest(payload.requestId, { models: payload.models });
    }
  });

  registry.on("copilot:mode-response" as never, (_daemonId: string, payload: { requestId: string; sessionId: string; mode: string }) => {
    aggregator.resolveRequest(payload.requestId, { mode: payload.mode });
  });

  registry.on(
    "copilot:agent-response" as never,
    (
      _daemonId: string,
      payload: {
        requestId: string;
        sessionId: string;
        agentId: string | null;
        agentName: string | null;
        error?: string;
      },
    ) => {
      aggregator.resolveRequest(payload.requestId, {
        sessionId: payload.sessionId,
        agentId: payload.agentId,
        agentName: payload.agentName,
        ...(payload.error ? { error: payload.error } : {}),
      });
    },
  );

  registry.on("copilot:plan-response" as never, (_daemonId: string, payload: { requestId: string; sessionId: string; plan: { exists: boolean; content: string | null; path: string | null } }) => {
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

    // Emit attention events for review requests and blockers
    if (record.tool === "request_human_review" || record.tool === "report_blocker") {
      fastify.ws.broadcast("attention", {
        type: "attention:copilot-tool",
        tool: record.tool,
        sessionId: record.sessionId,
        projectId: record.projectId,
        args: record.args,
        timestamp: record.timestamp,
      });

      // Create inbox message and persist
      const [owner, repo] = record.projectId.split("/");
      if (owner && repo) {
        const args = record.args as Record<string, unknown>;
        const title = String(
          args.title ?? args.message ?? args.reason ?? record.tool,
        );
        const inboxMsg: InboxMessage = {
          id: randomUUID(),
          projectId: record.projectId,
          sessionId: record.sessionId,
          tool: record.tool,
          args,
          title,
          status: "unread",
          createdAt: new Date(record.timestamp).toISOString(),
        };

        // Fire-and-forget persistence (log errors, don't block event loop)
        fastify.stateService
          .getInbox(owner, repo)
          .then((inbox) => {
            inbox.messages.push(inboxMsg);
            return fastify.stateService.saveInbox(owner, repo, inbox);
          })
          .then(() => {
            fastify.ws.broadcast("inbox", {
              type: "inbox:new-message",
              projectId: record.projectId,
              message: inboxMsg,
            });
          })
          .catch((err) => {
            fastify.log.error({ err, projectId: record.projectId }, "Failed to persist inbox message");
          });
      }
    }
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
