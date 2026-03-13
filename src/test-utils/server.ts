import Fastify, { type FastifyInstance } from "fastify";

/**
 * Create a lightweight Fastify instance for testing with `inject()`.
 * Caller is responsible for registering routes/plugins before calling inject.
 */
export async function createTestServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  return server;
}

export { type FastifyInstance };
