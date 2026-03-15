/**
 * Auth middleware — Jupyter-style URL token authentication.
 *
 * Protects all `/api/*` and `/preview/*` routes with a bearer token
 * that is generated at server boot (reuses the WS sessionToken).
 *
 * Exempt paths:
 *   - /api/health  (unauthenticated health check)
 *   - Static files  (not under /api/ or /preview/)
 *   - /ws/*         (WebSocket paths have their own auth)
 */
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/** Paths that are exempt from token auth. */
const EXEMPT_PATHS = new Set(["/api/health"]);

async function authPlugin(fastify: FastifyInstance) {
  const hqToken = fastify.sessionToken;

  fastify.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0]; // strip query string for matching

    // Only protect /api/* and /preview/* routes
    if (!url.startsWith("/api/") && !url.startsWith("/preview/")) {
      return;
    }

    // Allow exempt paths through without auth
    if (EXEMPT_PATHS.has(url)) {
      return;
    }

    // Check Authorization: Bearer <token> header
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const [scheme, token] = authHeader.split(" ", 2);
      if (scheme === "Bearer" && token === hqToken) {
        return;
      }
    }

    // Fallback: check ?token= query param (for browser-initiated requests)
    const queryToken = (request.query as Record<string, string>)?.token;
    if (queryToken === hqToken) {
      return;
    }

    return reply.status(401).send({
      error: "unauthorized",
      message: "Valid Authorization: Bearer <token> header or ?token= query param required",
    });
  });
}

export default fp(authPlugin, {
  name: "hq-auth",
  dependencies: ["websocket"], // sessionToken is decorated by websocket plugin
});
