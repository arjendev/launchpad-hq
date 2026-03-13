import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServer, type FastifyInstance } from "../../../test-utils/server.js";
import websocket from "../../ws/plugin.js";
import copilotPlugin from "../plugin.js";

describe("Copilot plugin — REST endpoints", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await createTestServer();
    await server.register(websocket);
    await server.register(copilotPlugin, {
      mock: true,
      mockUpdateIntervalMs: 0, // no background simulation in tests
    });
  });

  afterEach(async () => {
    await server.close();
  });

  // ── GET /api/copilot/sessions ────────────────────────

  it("GET /api/copilot/sessions returns session list", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/copilot/sessions",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toHaveProperty("sessions");
    expect(body).toHaveProperty("count");
    expect(body).toHaveProperty("adapter", "mock");
    expect(body.sessions).toBeInstanceOf(Array);
    expect(body.count).toBe(body.sessions.length);
  });

  it("session summaries have expected shape", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/copilot/sessions",
    });

    const { sessions } = response.json();
    for (const session of sessions) {
      expect(session).toHaveProperty("id");
      expect(session).toHaveProperty("status");
      expect(session).toHaveProperty("startedAt");
      expect(session).toHaveProperty("repository");
      expect(session).toHaveProperty("messageCount");
      expect(session).toHaveProperty("adapter", "mock");
      // Summaries should NOT include conversationHistory
      expect(session).not.toHaveProperty("conversationHistory");
    }
  });

  // ── GET /api/copilot/sessions/:id ────────────────────

  it("GET /api/copilot/sessions/:id returns full session", async () => {
    // Get an ID first
    const listResponse = await server.inject({
      method: "GET",
      url: "/api/copilot/sessions",
    });

    const { sessions } = listResponse.json();
    const targetId = sessions[0].id;

    const response = await server.inject({
      method: "GET",
      url: `/api/copilot/sessions/${targetId}`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.id).toBe(targetId);
    expect(body).toHaveProperty("conversationHistory");
    expect(body.conversationHistory).toBeInstanceOf(Array);
    expect(body).toHaveProperty("adapter", "mock");
  });

  it("conversation messages have expected shape", async () => {
    const listResponse = await server.inject({
      method: "GET",
      url: "/api/copilot/sessions",
    });

    const { sessions } = listResponse.json();
    const targetId = sessions[0].id;

    const response = await server.inject({
      method: "GET",
      url: `/api/copilot/sessions/${targetId}`,
    });

    const body = response.json();
    for (const msg of body.conversationHistory) {
      expect(msg).toHaveProperty("id");
      expect(msg).toHaveProperty("role");
      expect(msg).toHaveProperty("content");
      expect(msg).toHaveProperty("timestamp");
      expect(["user", "assistant", "system"]).toContain(msg.role);
    }
  });

  it("returns 404 for unknown session id", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/copilot/sessions/nonexistent",
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body).toHaveProperty("error", "Session not found");
  });

  // ── Plugin decoration ────────────────────────────────

  it("decorates fastify with copilot manager", async () => {
    expect(server.copilot).toBeDefined();
    expect(typeof server.copilot.listSessions).toBe("function");
    expect(typeof server.copilot.getSession).toBe("function");
  });
});
