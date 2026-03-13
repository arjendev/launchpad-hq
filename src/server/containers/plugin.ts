import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ContainerMonitor } from "./monitor.js";
import type { DiscoveryResult } from "./types.js";

declare module "fastify" {
  interface FastifyInstance {
    containers: {
      /** Get the latest discovery result. */
      latest: () => DiscoveryResult | null;
      /** Force a poll cycle now. */
      poll: () => Promise<void>;
    };
  }
}

async function containersPlugin(fastify: FastifyInstance) {
  const monitor = new ContainerMonitor({
    broadcast: (channel, payload) => fastify.ws.broadcast(channel, payload),
    log: fastify.log,
  });

  // Decorate Fastify so routes/other plugins can access container state
  fastify.decorate("containers", {
    latest: () => monitor.lastResult,
    poll: () => monitor.poll(),
  });

  // REST endpoint: GET /api/devcontainers
  fastify.get("/api/devcontainers", async (_request, _reply) => {
    const result = monitor.lastResult;

    if (!result) {
      // First poll hasn't completed yet — trigger one
      await monitor.poll();
      const fresh = monitor.lastResult;
      return fresh ?? { containers: [], scannedAt: new Date().toISOString(), dockerAvailable: false };
    }

    return result;
  });

  // Start monitoring after server is ready
  fastify.addHook("onReady", async () => {
    monitor.start();
  });

  // Clean up on shutdown
  fastify.addHook("onClose", () => {
    monitor.stop();
  });
}

export default fp(containersPlugin, {
  name: "containers",
  dependencies: ["websocket"],
});
