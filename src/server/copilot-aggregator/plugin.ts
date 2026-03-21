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

  registry.on("copilot:session-list", (daemonId: string, payload: { projectId: string; requestId?: string; sessions: SessionMetadata[] }) => {
    aggregator.updateSessions(daemonId, payload.projectId, payload.sessions);

    // Resolve any pending request-response (e.g. from the resume-picker endpoint)
    if (payload.requestId) {
      aggregator.resolveRequest(payload.requestId, { sessions: payload.sessions });
    }
  });

  registry.on("copilot:session-event", (daemonId: string, payload: { projectId: string; sessionId: string; sessionType?: SessionType; event: SessionEvent }) => {
    aggregator.handleSessionEvent(daemonId, payload.sessionId, payload.event);

    // Track session type if provided
    if (payload.sessionType) {
      aggregator.setSessionType(payload.sessionId, payload.sessionType);
    }

    // Track subagent display names so we can enrich persisted messages
    if (payload.event.type === "subagent.started") {
      const d = payload.event.data as { toolCallId?: string; agentDisplayName?: string; agentName?: string };
      if (d.toolCallId) {
        subagentNamesByToolCallId.set(d.toolCallId, d.agentDisplayName ?? d.agentName ?? "subagent");
      }
    }

    // Track the selected main agent name
    if (payload.event.type === "subagent.selected") {
      const d = payload.event.data as { agentDisplayName?: string; agentName?: string };
      mainAgentNameBySession.set(payload.sessionId, d.agentDisplayName ?? d.agentName ?? "");
    }
    if (payload.event.type === "subagent.deselected") {
      mainAgentNameBySession.delete(payload.sessionId);
    }

    // Persist assistant messages to conversation history so they survive refresh
    if (payload.event.type === "assistant.message") {
      const data = payload.event.data as {
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
          timestamp: new Date(payload.event.timestamp).getTime(),
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
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

  registry.on("copilot:sdk-state", (daemonId: string, payload: { projectId: string; state: ConnectionState; error?: string }) => {
    aggregator.handleSdkStateChange(daemonId, payload.state, payload.error);
  });

  registry.on("copilot:conversation", (_daemonId: string, payload: { sessionId: string; messages: CopilotMessage[] }) => {
    aggregator.appendMessages(payload.sessionId, payload.messages);
  });

  registry.on("copilot:tool-invocation", (_daemonId: string, payload: {
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

  registry.on("copilot:models-list", (_daemonId: string, payload: { requestId?: string; models: ModelInfo[] }) => {
    if (payload.requestId) {
      aggregator.resolveRequest(payload.requestId, { models: payload.models });
    }
  });

  registry.on("copilot:mode-response", (_daemonId: string, payload: { requestId: string; sessionId: string; mode: string }) => {
    aggregator.resolveRequest(payload.requestId, { mode: payload.mode });
  });

  registry.on(
    "copilot:agent-response",
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

  registry.on("copilot:plan-response", (_daemonId: string, payload: { requestId: string; sessionId: string; plan: { exists: boolean; content: string | null; path: string | null } }) => {
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
