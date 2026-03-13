import type { FastifyPluginAsync } from "fastify";

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/health", async () => {
    return {
      status: "ok",
      uptime: process.uptime(),
    };
  });
};

export default healthRoutes;
