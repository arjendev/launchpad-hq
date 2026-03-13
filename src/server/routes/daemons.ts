import type { FastifyPluginAsync } from "fastify";
import type { CommandAction } from "../../shared/protocol.js";

const daemonRoutes: FastifyPluginAsync = async (server) => {
  /** GET /api/daemons — list all connected daemons */
  server.get("/api/daemons", async (_request, reply) => {
    const daemons = server.daemonRegistry.getAllDaemons();
    return reply.send(daemons);
  });

  /** GET /api/daemons/:id — get detailed daemon info */
  server.get<{ Params: { id: string } }>("/api/daemons/:id", async (request, reply) => {
    const daemon = server.daemonRegistry.getDaemon(request.params.id);
    if (!daemon) {
      return reply.status(404).send({ error: "not_found", message: "Daemon not found" });
    }
    return reply.send({
      daemonId: daemon.daemonId,
      projectId: daemon.info.projectId,
      projectName: daemon.info.projectName,
      runtimeTarget: daemon.info.runtimeTarget,
      state: daemon.state,
      connectedAt: daemon.connectedAt,
      lastHeartbeat: daemon.lastHeartbeat,
      disconnectedAt: daemon.disconnectedAt,
      version: daemon.info.version,
      capabilities: daemon.info.capabilities,
      protocolVersion: daemon.info.protocolVersion,
    });
  });

  /** POST /api/daemons/:id/command — send command to a specific daemon */
  server.post<{
    Params: { id: string };
    Body: { action: CommandAction; args?: Record<string, unknown> };
  }>("/api/daemons/:id/command", async (request, reply) => {
    const { id } = request.params;
    const { action, args } = request.body ?? {};

    if (!action) {
      return reply.status(400).send({ error: "bad_request", message: "Missing 'action' field" });
    }

    const daemon = server.daemonRegistry.getDaemon(id);
    if (!daemon) {
      return reply.status(404).send({ error: "not_found", message: "Daemon not found" });
    }

    const sent = server.daemonRegistry.sendToDaemon(id, {
      type: "command",
      timestamp: Date.now(),
      payload: {
        projectId: daemon.info.projectId,
        action,
        args,
      },
    });

    if (!sent) {
      return reply.status(502).send({ error: "send_failed", message: "Daemon not connected" });
    }

    return reply.send({ ok: true });
  });
};

export default daemonRoutes;
