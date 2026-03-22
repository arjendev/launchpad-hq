import type { FastifyPluginAsync } from "fastify";
import type {
  CopilotSessionMode,
  PromptDeliveryMode,
  SessionConfigWire,
  SessionType,
} from "../../shared/protocol.js";
import { randomUUID } from "node:crypto";

type CreateSessionConfig = SessionConfigWire;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const notFound = { error: "not_found", message: "Session not found" } as const;
const sendFailed = { error: "send_failed", message: "Daemon not connected" } as const;
const COPILOT_SESSION_MODES = new Set<CopilotSessionMode>(["interactive", "plan", "autopilot"]);
type SessionAgentResponse = {
  sessionId: string;
  agentId: string | null;
  agentName: string | null;
  error?: string;
};

function normalizeAgentSelection(
  value: unknown,
  fieldName: "agent" | "agentId",
): { ok: true; value: string | null | undefined } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, message: `'${fieldName}' must be a string or null` };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: `'${fieldName}' cannot be an empty string. Use null for the default agent.`,
    };
  }

  return { ok: true, value: trimmed };
}

function isCopilotSessionMode(value: unknown): value is CopilotSessionMode {
  return typeof value === "string" && COPILOT_SESSION_MODES.has(value as CopilotSessionMode);
}

function agentResponseStatus(message: string): number {
  if (message.includes("Unknown Copilot agent selection")) {
    return 400;
  }
  if (message.includes("No active session")) {
    return 409;
  }
  return 500;
}

/** Look up internal session (with daemonId) and send a message to its daemon.
 *  Returns the reply on failure, or undefined on success. */
function sendToDaemon(
  server: Parameters<FastifyPluginAsync>[0],
  sessionId: string,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  buildMessage: (daemonId: string) => Parameters<typeof server.daemonRegistry.sendToDaemon>[1],
  otelContext?: import("@opentelemetry/api").Context,
): boolean {
  const internal = server.copilotAggregator.getInternalSession(sessionId);
  if (!internal) {
    reply.status(404).send(notFound);
    return false;
  }
  const sent = server.daemonRegistry.sendToDaemon(internal.daemonId, buildMessage(internal.daemonId), otelContext);
  if (!sent) {
    reply.status(502).send(sendFailed);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const copilotSessionRoutes: FastifyPluginAsync = async (server) => {

  // ── Read-only session queries ─────────────────────────

  /** GET /api/copilot/aggregated/sessions — Aggregated sessions, optionally filtered by projectId */
  server.get<{ Querystring: { projectId?: string } }>(
    "/api/copilot/aggregated/sessions",
    async (request, reply) => {
      const { projectId } = request.query;
      const sessions = projectId
        ? server.copilotAggregator.getSessionsByProject(projectId)
        : server.copilotAggregator.getAllSessions();
      return reply.send({ sessions, count: sessions.length });
    },
  );

  /** GET /api/copilot/aggregated/sessions/:sessionId — Single session detail */
  server.get<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId",
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = server.copilotAggregator.getSession(sessionId);

      if (!session) {
        return reply.status(404).send(notFound);
      }

      return reply.send(session);
    },
  );

  /** GET /api/copilot/aggregated/sessions/:sessionId/messages — Full message history */
  server.get<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/messages",
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = server.copilotAggregator.getSession(sessionId);

      if (!session) {
        return reply.status(404).send(notFound);
      }

      const messages = server.copilotAggregator.getMessages(sessionId);
      return reply.send({ sessionId, messages, count: messages.length });
    },
  );

  /** GET /api/copilot/aggregated/sessions/:sessionId/tools — Tool invocation history */
  server.get<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/tools",
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = server.copilotAggregator.getSession(sessionId);

      if (!session) {
        return reply.status(404).send(notFound);
      }

      const invocations = server.copilotAggregator.getToolInvocations(sessionId);
      return reply.send({ sessionId, invocations, count: invocations.length });
    },
  );

  /** GET /api/copilot/aggregated/sessions/:sessionId/events — Paginated event log */
  server.get<{
    Params: { sessionId: string };
    Querystring: { before?: string; limit?: string };
  }>(
    "/api/copilot/aggregated/sessions/:sessionId/events",
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = server.copilotAggregator.getSession(sessionId);

      if (!session) {
        return reply.status(404).send(notFound);
      }

      const { before, limit: limitStr } = request.query;
      const limit = limitStr ? Math.max(1, Math.min(Number(limitStr) || 100, 500)) : 100;

      const result = server.copilotAggregator.getEvents(sessionId, before, limit);
      return reply.send(result);
    },
  );

  // ── Session actions (fire-and-forget) ─────────────────

  /** POST /api/copilot/aggregated/sessions/:sessionId/send — Send prompt to session */
  server.post<{
    Params: { sessionId: string };
    Body: { prompt: string; mode?: PromptDeliveryMode };
  }>(
    "/api/copilot/aggregated/sessions/:sessionId/send",
    async (request, reply) => {
      const { sessionId } = request.params;
      const { prompt, mode } = request.body ?? {};

      if (!prompt) {
        return reply
          .status(400)
          .send({ error: "bad_request", message: "Missing 'prompt' field" });
      }

      const internal = server.copilotAggregator.getInternalSession(sessionId);
      if (!internal) {
        return reply.status(404).send(notFound);
      }

      // Record the injected prompt in conversation history
      server.copilotAggregator.appendMessages(sessionId, [
        {
          role: "user",
          content: prompt,
          timestamp: Date.now(),
          source: "hq-injection",
        },
      ]);

      const sent = server.daemonRegistry.sendToDaemon(internal.daemonId, {
        type: "copilot-send-prompt",
        timestamp: Date.now(),
        payload: { sessionId, prompt, ...(mode ? { mode } : {}) },
      }, request.otelContext);

      if (!sent) {
        return reply.status(502).send(sendFailed);
      }

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/abort — Abort current turn */
  server.post<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/abort",
    async (request, reply) => {
      const { sessionId } = request.params;

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-abort-session",
        timestamp: Date.now(),
        payload: { sessionId },
      }), request.otelContext);
      if (!ok) return;

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/resume — Resume a session */
  server.post<{
    Params: { sessionId: string };
    Body: { config?: Partial<SessionConfigWire>; sessionType?: SessionType };
  }>(
    "/api/copilot/aggregated/sessions/:sessionId/resume",
    async (request, reply) => {
      const { sessionId } = request.params;
      const { config, sessionType } = request.body ?? {};
      const requestId = randomUUID();

      const internal = server.copilotAggregator.getInternalSession(sessionId);
      if (!internal) {
        return reply.status(404).send(notFound);
      }

      // Inject HQ's default model when no model is explicitly specified
      const effectiveConfig: Partial<SessionConfigWire> = { ...config };
      if (!effectiveConfig.model) {
        effectiveConfig.model = server.launchpadConfig.copilot.defaultModel;
      }

      const sent = server.daemonRegistry.sendToDaemon(internal.daemonId, {
        type: "copilot-resume-session",
        timestamp: Date.now(),
        payload: { requestId, sessionId, sessionType, config: effectiveConfig },
      }, request.otelContext);
      if (!sent) {
        return reply.status(502).send(sendFailed);
      }

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/set-model — Change session model */
  server.post<{
    Params: { sessionId: string };
    Body: { model: string };
  }>(
    "/api/copilot/aggregated/sessions/:sessionId/set-model",
    async (request, reply) => {
      const { sessionId } = request.params;
      const { model } = request.body ?? {};

      if (!model) {
        return reply
          .status(400)
          .send({ error: "bad_request", message: "Missing 'model' field" });
      }

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-set-model",
        timestamp: Date.now(),
        payload: { sessionId, model },
      }), request.otelContext);
      if (!ok) return;

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/mode — Set session mode */
  server.post<{
    Params: { sessionId: string };
    Body: { mode: string };
  }>(
    "/api/copilot/aggregated/sessions/:sessionId/mode",
    async (request, reply) => {
      const { sessionId } = request.params;
      const { mode } = request.body ?? {};

      if (!mode) {
        return reply
          .status(400)
          .send({ error: "bad_request", message: "Missing 'mode' field" });
      }

      if (!isCopilotSessionMode(mode)) {
        return reply.status(400).send({
          error: "bad_request",
          message: "Mode must be one of: interactive, plan, autopilot",
        });
      }

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-set-mode",
        timestamp: Date.now(),
        payload: { sessionId, mode },
      }), request.otelContext);
      if (!ok) return;

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/plan — Update plan content */
  server.post<{
    Params: { sessionId: string };
    Body: { content: string };
  }>(
    "/api/copilot/aggregated/sessions/:sessionId/plan",
    async (request, reply) => {
      const { sessionId } = request.params;
      const { content } = request.body ?? {};

      if (content === undefined || content === null) {
        return reply
          .status(400)
          .send({ error: "bad_request", message: "Missing 'content' field" });
      }

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-update-plan",
        timestamp: Date.now(),
        payload: { sessionId, content },
      }), request.otelContext);
      if (!ok) return;

      return reply.send({ ok: true });
    },
  );

  /** DELETE /api/copilot/aggregated/sessions/:sessionId/plan — Delete plan */
  server.delete<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/plan",
    async (request, reply) => {
      const { sessionId } = request.params;

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-delete-plan",
        timestamp: Date.now(),
        payload: { sessionId },
      }), request.otelContext);
      if (!ok) return;

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/delete — End/delete a session */
  server.post<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/delete",
    async (request, reply) => {
      const { sessionId } = request.params;

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-delete-session",
        timestamp: Date.now(),
        payload: { sessionId },
      }), request.otelContext);
      if (!ok) return;

      // Tombstone locally so UI sees it immediately
      server.copilotAggregator.removeSession(sessionId);

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/disconnect — Disconnect session */
  server.post<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/disconnect",
    async (request, reply) => {
      const { sessionId } = request.params;

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-disconnect-session",
        timestamp: Date.now(),
        payload: { sessionId },
      }), request.otelContext);
      if (!ok) return;

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/permission-response — Relay permission decision to daemon */
  server.post<{ Params: { sessionId: string }; Body: { requestId: string; decision: 'allow' | 'deny' } }>(
    "/api/copilot/aggregated/sessions/:sessionId/permission-response",
    async (request, reply) => {
      const { sessionId } = request.params;
      const { requestId, decision } = request.body ?? {} as Record<string, unknown>;

      if (!requestId || !decision || !['allow', 'deny'].includes(decision as string)) {
        return reply.status(400).send({ error: "bad_request", message: "requestId and decision ('allow' | 'deny') are required" });
      }

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-permission-response",
        timestamp: Date.now(),
        payload: { requestId: requestId as string, sessionId, decision: decision as 'allow' | 'deny' },
      }), request.otelContext);
      if (!ok) return;

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/user-input-response — Relay user input answer to daemon */
  server.post<{ Params: { sessionId: string }; Body: { requestId: string; answer: string; wasFreeform?: boolean } }>(
    "/api/copilot/aggregated/sessions/:sessionId/user-input-response",
    async (request, reply) => {
      const { sessionId } = request.params;
      const { requestId, answer, wasFreeform } = request.body ?? {} as Record<string, unknown>;

      if (!requestId || typeof answer !== 'string') {
        return reply.status(400).send({ error: "bad_request", message: "requestId and answer (string) are required" });
      }

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-user-input-response",
        timestamp: Date.now(),
        payload: { requestId: requestId as string, sessionId, answer: answer as string, wasFreeform: Boolean(wasFreeform) },
      }), request.otelContext);
      if (!ok) return;

      return reply.send({ ok: true });
    },
  );

  // ── Request-response routes (wait for daemon reply) ───

  /** GET /api/copilot/aggregated/sessions/:sessionId/mode — Get current mode */
  server.get<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/mode",
    async (request, reply) => {
      const { sessionId } = request.params;
      const requestId = randomUUID();

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-get-mode",
        timestamp: Date.now(),
        payload: { requestId, sessionId },
      }), request.otelContext);
      if (!ok) return;

      try {
        const result = await server.copilotAggregator.waitForResponse<{ mode: string }>(requestId);
        return reply.send(result);
      } catch {
        return reply
          .status(504)
          .send({ error: "timeout", message: "Daemon did not respond in time" });
      }
    },
  );

  /** GET /api/copilot/aggregated/sessions/:sessionId/agent — Get current agent */
  server.get<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/agent",
    async (request, reply) => {
      const { sessionId } = request.params;
      const requestId = randomUUID();

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-get-agent",
        timestamp: Date.now(),
        payload: { requestId, sessionId },
      }), request.otelContext);
      if (!ok) return;

      try {
        const result =
          await server.copilotAggregator.waitForResponse<SessionAgentResponse>(requestId);
        if (result.error) {
          return reply
            .status(agentResponseStatus(result.error))
            .send({ error: "agent_error", message: result.error });
        }
        return reply.send({
          sessionId,
          agentId: result.agentId ?? null,
          agentName: result.agentName ?? null,
        });
      } catch {
        return reply
          .status(504)
          .send({ error: "timeout", message: "Daemon did not respond in time" });
      }
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/agent — Switch current agent */
  server.post<{
    Params: { sessionId: string };
    Body: { agentId?: string | null };
  }>(
    "/api/copilot/aggregated/sessions/:sessionId/agent",
    async (request, reply) => {
      const { sessionId } = request.params;
      const parsedAgentId = normalizeAgentSelection(
        (request.body as { agentId?: unknown } | undefined)?.agentId,
        "agentId",
      );
      if (!parsedAgentId.ok) {
        return reply.status(400).send({ error: "bad_request", message: parsedAgentId.message });
      }
      if (parsedAgentId.value === undefined) {
        return reply
          .status(400)
          .send({ error: "bad_request", message: "Missing 'agentId' field" });
      }
      const agentId = parsedAgentId.value;

      const requestId = randomUUID();
      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-set-agent",
        timestamp: Date.now(),
        payload: { requestId, sessionId, agentId },
      }), request.otelContext);
      if (!ok) return;

      try {
        const result =
          await server.copilotAggregator.waitForResponse<SessionAgentResponse>(requestId);
        if (result.error) {
          return reply
            .status(agentResponseStatus(result.error))
            .send({ error: "agent_error", message: result.error });
        }
        return reply.send({
          sessionId,
          agentId: result.agentId ?? null,
          agentName: result.agentName ?? null,
        });
      } catch {
        return reply
          .status(504)
          .send({ error: "timeout", message: "Daemon did not respond in time" });
      }
    },
  );

  /** GET /api/copilot/aggregated/sessions/:sessionId/plan — Get plan content */
  server.get<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/plan",
    async (request, reply) => {
      const { sessionId } = request.params;
      const requestId = randomUUID();

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-get-plan",
        timestamp: Date.now(),
        payload: { requestId, sessionId },
      }), request.otelContext);
      if (!ok) return;

      try {
        const result = await server.copilotAggregator.waitForResponse<{ plan: { exists: boolean; content: string | null; path: string | null } }>(requestId);
        return reply.send(result);
      } catch {
        return reply
          .status(504)
          .send({ error: "timeout", message: "Daemon did not respond in time" });
      }
    },
  );

  /** GET /api/copilot/models — List available models */
  server.get("/api/copilot/models", async (_request, reply) => {
    // Pick any connected daemon to query models from
    const daemons = server.daemonRegistry.getAllDaemons();
    if (daemons.length === 0) {
      return reply
        .status(503)
        .send({ error: "no_daemons", message: "No daemons connected" });
    }

    const requestId = randomUUID();
    const sent = server.daemonRegistry.sendToDaemon(daemons[0].daemonId, {
      type: "copilot-list-models",
      timestamp: Date.now(),
      payload: { requestId },
    });

    if (!sent) {
      return reply.status(502).send(sendFailed);
    }

    try {
      const result = await server.copilotAggregator.waitForResponse<{ models: unknown[] }>(requestId);
      return reply.send(result);
    } catch {
      return reply
        .status(504)
        .send({ error: "timeout", message: "Daemon did not respond in time" });
    }
  });

  // ── Create session on specific daemon ─────────────────

  /** POST /api/daemons/:owner/:repo/copilot/sessions — Create new session on a specific daemon */
  server.post<{
    Params: { owner: string; repo: string };
    Body: {
      model?: string;
      sessionType?: SessionType;
      agentId?: string | null;
      agent?: string | null;
    };
  }>("/api/daemons/:owner/:repo/copilot/sessions", async (request, reply) => {
    const id = `${request.params.owner}/${request.params.repo}`;
    const { model, sessionType } = request.body ?? {};
    const parsedAgentId = normalizeAgentSelection(
      (request.body as { agentId?: unknown } | undefined)?.agentId,
      "agentId",
    );
    if (!parsedAgentId.ok) {
      return reply.status(400).send({ error: "bad_request", message: parsedAgentId.message });
    }
    const parsedLegacyAgent = normalizeAgentSelection(
      (request.body as { agent?: unknown } | undefined)?.agent,
      "agent",
    );
    if (!parsedLegacyAgent.ok) {
      return reply
        .status(400)
        .send({ error: "bad_request", message: parsedLegacyAgent.message });
    }

    if (
      parsedAgentId.value !== undefined &&
      parsedLegacyAgent.value !== undefined &&
      parsedAgentId.value !== parsedLegacyAgent.value
    ) {
      return reply.status(400).send({
        error: "bad_request",
        message: "'agentId' and legacy 'agent' must match when both are provided",
      });
    }

    const explicitAgentId =
      parsedAgentId.value !== undefined ? parsedAgentId.value : parsedLegacyAgent.value;

    const daemon = server.daemonRegistry.getDaemon(id);
    if (!daemon) {
      return reply
        .status(404)
        .send({ error: "not_found", message: "Daemon not found" });
    }

    const effectiveSessionType = sessionType ?? "copilot-sdk";
    const config: CreateSessionConfig = {};
    if (model) {
      config.model = model;
    } else {
      // Inject HQ's default model when no model is explicitly specified
      config.model = server.launchpadConfig.copilot.defaultModel;
    }
    if (effectiveSessionType === "copilot-sdk") {
      if (explicitAgentId !== undefined) {
        config.agentId = explicitAgentId;
      }
    }

    const requestId = randomUUID();
    const sent = server.daemonRegistry.sendToDaemon(id, {
      type: "copilot-create-session",
      timestamp: Date.now(),
      payload: {
        requestId,
        sessionType: effectiveSessionType,
        config: Object.keys(config).length > 0 ? config : undefined,
      },
    });

    if (!sent) {
      return reply.status(502).send(sendFailed);
    }

    try {
      const result = await server.copilotAggregator.waitForResponse<{ sessionId: string }>(requestId);
      return reply.send({ ok: true, sessionId: result.sessionId, sessionType: effectiveSessionType });
    } catch {
      return reply
        .status(504)
        .send({ error: "timeout", message: "Session creation timed out" });
    }
  });
};

export default copilotSessionRoutes;
