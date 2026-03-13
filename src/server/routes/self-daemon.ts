import type { FastifyPluginAsync } from "fastify";

const selfDaemonRoutes: FastifyPluginAsync = async (server) => {
  /** GET /api/self-daemon — status of the self-daemon */
  server.get("/api/self-daemon", async (_request, reply) => {
    return reply.send(server.selfDaemon.getStatus());
  });

  /** POST /api/self-daemon/start — start the self-daemon */
  server.post("/api/self-daemon/start", async (_request, reply) => {
    if (server.selfDaemon.isRunning()) {
      return reply.status(409).send({
        error: "already_running",
        message: "Self-daemon is already running",
      });
    }
    await server.selfDaemon.start();
    return reply.send(server.selfDaemon.getStatus());
  });

  /** POST /api/self-daemon/stop — stop the self-daemon */
  server.post("/api/self-daemon/stop", async (_request, reply) => {
    if (!server.selfDaemon.isRunning()) {
      return reply.status(409).send({
        error: "not_running",
        message: "Self-daemon is not running",
      });
    }
    await server.selfDaemon.stop();
    return reply.send(server.selfDaemon.getStatus());
  });

  /** POST /api/self-daemon/restart — restart the self-daemon */
  server.post("/api/self-daemon/restart", async (_request, reply) => {
    if (server.selfDaemon.isRunning()) {
      await server.selfDaemon.stop();
    }
    await server.selfDaemon.start();
    return reply.send(server.selfDaemon.getStatus());
  });
};

export default selfDaemonRoutes;
