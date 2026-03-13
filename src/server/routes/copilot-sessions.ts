import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";

const copilotSessionRoutes: FastifyPluginAsync = async (server) => {
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
        return reply
          .status(404)
          .send({ error: "not_found", message: "Session not found" });
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
        return reply
          .status(404)
          .send({ error: "not_found", message: "Session not found" });
      }

      const messages = server.copilotAggregator.getMessages(sessionId);
      return reply.send({ sessionId, messages, count: messages.length });
    },
  );

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

      const session = server.copilotAggregator.getSession(sessionId);
      if (!session) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Session not found" });
      }

      const sent = server.daemonRegistry.sendToDaemon(session.daemonId, {
        type: "copilot-send-prompt",
        timestamp: Date.now(),
        payload: {
          sessionId,
          prompt,
        },
      });

      if (!sent) {
        return reply
          .status(502)
          .send({ error: "send_failed", message: "Daemon not connected" });
      }

      return reply.send({ ok: true });
    },
  );

  /** POST /api/copilot/aggregated/sessions/:sessionId/abort — Abort session */
  server.post<{ Params: { sessionId: string } }>(
    "/api/copilot/aggregated/sessions/:sessionId/abort",
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = server.copilotAggregator.getSession(sessionId);

      if (!session) {
        return reply
          .status(404)
          .send({ error: "not_found", message: "Session not found" });
      }

      const sent = server.daemonRegistry.sendToDaemon(session.daemonId, {
        type: "copilot-abort-session",
        timestamp: Date.now(),
        payload: {
          sessionId,
        },
      });

      if (!sent) {
        return reply
          .status(502)
          .send({ error: "send_failed", message: "Daemon not connected" });
      }

      return reply.send({ ok: true });
    },
  );

  /** POST /api/daemons/:id/copilot/sessions — Create new session on a specific daemon */
  server.post<{
    Params: { id: string };
    Body: { model?: string };
  }>("/api/daemons/:id/copilot/sessions", async (request, reply) => {
    const { id } = request.params;
    const { model } = request.body ?? {};

    const daemon = server.daemonRegistry.getDaemon(id);
    if (!daemon) {
      return reply
        .status(404)
        .send({ error: "not_found", message: "Daemon not found" });
    }

    const sent = server.daemonRegistry.sendToDaemon(id, {
      type: "copilot-create-session",
      timestamp: Date.now(),
      payload: {
        requestId: randomUUID(),
        config: model ? { model } : undefined,
      },
    });

    if (!sent) {
      return reply
        .status(502)
        .send({ error: "send_failed", message: "Daemon not connected" });
    }

    return reply.send({ ok: true });
  });
};

export default copilotSessionRoutes;
