import Fastify from "fastify";
/**
 * Create a lightweight Fastify instance for testing with `inject()`.
 * Caller is responsible for registering routes before calling inject.
 */
export async function createTestServer() {
    const server = Fastify({ logger: false });
    return server;
}
//# sourceMappingURL=index.js.map