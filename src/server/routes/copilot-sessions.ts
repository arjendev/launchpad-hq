import type { FastifyPluginAsync } from "fastify";
import type { SessionConfigWire } from "../../shared/protocol.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const notFound = { error: "not_found", message: "Session not found" } as const;
const sendFailed = { error: "send_failed", message: "Daemon not connected" } as const;

/** Look up internal session (with daemonId) and send a message to its daemon.
 *  Returns the reply on failure, or undefined on success. */
function sendToDaemon(
  server: Parameters<FastifyPluginAsync>[0],
  sessionId: string,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  buildMessage: (daemonId: string) => Parameters<typeof server.daemonRegistry.sendToDaemon>[1],
): boolean {
  const internal = server.copilotAggregator.getInternalSession(sessionId);
  if (!internal) {
    reply.status(404).send(notFound);
    return false;
  }
  const sent = server.daemonRegistry.sendToDaemon(internal.daemonId, buildMessage(internal.daemonId));
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

  /** GET /api/copilot/aggregated/sessions — All aggregated sessions across all daemons */
  server.get("/api/copilot/aggregated/sessions", async (_request, reply) => {
    const sessions = server.copilotAggregator.getAllSessions();
    return reply.send({ sessions, count: sessions.length });
  });

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

  // ── Session actions (fire-and-forget) ─────────────────

  /** POST /api/copilot/aggregated/sessions/:sessionId/send — Send prompt to session */
  server.post<{
    Params: { sessionId: string };
    Body: { prompt: string };
  }>(
    "/api/copilot/aggregated/sessions/:sessionId/send",
    async (request, reply) => {
      const { sessionId } = request.params;
      const { prompt } = request.body ?? {};

      if (!prompt) {
        return reply
          .status(400)
          .send({ error: "bad_request", message: "Missing 'prompt' field" });
      }

      const internal = server.copilotAggregator.getInternalSession(sessionId);
      if (!internal) {
        return reply.status(404).send(notFound);
      }

      if (internal.status === "active") {
        return reply
          .status(409)
          .send({ error: "conflict", message: "Session is currently processing" });
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
        payload: { sessionId, prompt },
      });

      if (!sent) {
        return reply.status(502).send(sendFailed);
      }

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/abort — Abort session */
  server.post<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/abort",
    async (request, reply) => {
      const { sessionId } = request.params;
      const internal = server.copilotAggregator.getInternalSession(sessionId);

      if (!internal) {
        return reply.status(404).send(notFound);
      }

      server.daemonRegistry.sendToDaemon(internal.daemonId, {
        type: "copilot-abort-session",
        timestamp: Date.now(),
        payload: { sessionId },
      });

      server.copilotAggregator.removeSession(sessionId);

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/resume — Resume a session */
  server.post<{
    Params: { sessionId: string };
    Body: { config?: Partial<SessionConfigWire> };
  }>(
    "/api/copilot/aggregated/sessions/:sessionId/resume",
    async (request, reply) => {
      const { sessionId } = request.params;
      const { config } = request.body ?? {};
      const requestId = randomUUID();

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-resume-session",
        timestamp: Date.now(),
        payload: { requestId, sessionId, config },
      }));
      if (!ok) return;

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
      }));
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

      const ok = sendToDaemon(server, sessionId, reply, () => ({
        type: "copilot-set-mode",
        timestamp: Date.now(),
        payload: { sessionId, mode },
      }));
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
      }));
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
      }));
      if (!ok) return;

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
      }));
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
      }));
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
      }));
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
    Body: { model?: string };
  }>("/api/daemons/:owner/:repo/copilot/sessions", async (request, reply) => {
    const id = `${request.params.owner}/${request.params.repo}`;
    const { model } = request.body ?? {};

    const daemon = server.daemonRegistry.getDaemon(id);
    if (!daemon) {
      return reply
        .status(404)
        .send({ error: "not_found", message: "Daemon not found" });
    }

    const requestId = randomUUID();
    const sent = server.daemonRegistry.sendToDaemon(id, {
      type: "copilot-create-session",
      timestamp: Date.now(),
      payload: {
        requestId,
        config: model ? { model } : undefined,
      },
    });

    if (!sent) {
      return reply.status(502).send(sendFailed);
    }

    try {
      const result = await server.copilotAggregator.waitForResponse<{ sessionId: string }>(requestId);
      return reply.send({ ok: true, sessionId: result.sessionId });
    } catch {
      return reply
        .status(504)
        .send({ error: "timeout", message: "Session creation timed out" });
    }
  });
};

export default copilotSessionRoutes;
