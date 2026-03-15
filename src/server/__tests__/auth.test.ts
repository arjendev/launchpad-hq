import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestServer, type FastifyInstance } from "../../test-utils/server.js";
import fp from "fastify-plugin";
import authPlugin from "../auth/plugin.js";
import healthRoutes from "../routes/health.js";

// Minimal websocket stub that decorates sessionToken
const fakeWsPlugin = fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate("sessionToken", "test-hq-token-abc123");
    fastify.decorate("ws", {
      broadcast: vi.fn(),
      sendToClient: vi.fn(),
      clients: () => 0,
    });
  },
  { name: "websocket" },
);

// A sample protected route plugin
async function sampleRoutes(fastify: FastifyInstance) {
  fastify.get("/api/data", async () => ({ hello: "world" }));
  fastify.get("/api/settings", async () => ({ mode: "local" }));
  fastify.get("/preview/test/index.html", async () => ({ html: "<h1>hi</h1>" }));
}

async function buildAuthServer() {
  const server = await createTestServer();
  await server.register(fakeWsPlugin);
  await server.register(authPlugin);
  await server.register(healthRoutes);
  await server.register(sampleRoutes);
  return server;
}

describe("Auth plugin", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildAuthServer();
  });

  afterEach(async () => {
    await server.close();
  });

  // ── Health endpoint is exempt ──────────────────────────

  it("allows /api/health without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  // ── Protected API routes ───────────────────────────────

  it("rejects /api/data without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/api/data" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("unauthorized");
  });

  it("allows /api/data with valid Bearer token", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/data",
      headers: { authorization: "Bearer test-hq-token-abc123" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hello).toBe("world");
  });

  it("allows /api/data with valid ?token= query param", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/data?token=test-hq-token-abc123",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hello).toBe("world");
  });

  it("rejects /api/data with wrong Bearer token", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/data",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects /api/data with wrong ?token= query param", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/data?token=wrong-token",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects /api/data with malformed auth header (no Bearer prefix)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/data",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Protected preview routes ───────────────────────────

  it("rejects /preview/* without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/preview/test/index.html" });
    expect(res.statusCode).toBe(401);
  });

  it("allows /preview/* with valid Bearer token", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/preview/test/index.html",
      headers: { authorization: "Bearer test-hq-token-abc123" },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── Non-protected routes pass through ──────────────────

  it("does not interfere with non-api/preview routes", async () => {
    // 404 is expected for unregistered route, but NOT 401
    const res = await server.inject({ method: "GET", url: "/some-other-path" });
    expect(res.statusCode).not.toBe(401);
  });
});

describe("Auth plugin — token not leaked from settings", () => {
  it("GET /api/settings does not include sessionToken", async () => {
    const server = await buildAuthServer();
    const res = await server.inject({
      method: "GET",
      url: "/api/settings",
      headers: { authorization: "Bearer test-hq-token-abc123" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toHaveProperty("sessionToken");
    await server.close();
  });
});
