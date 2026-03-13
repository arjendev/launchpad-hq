import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestServer, type FastifyInstance } from "../../../test-utils/server.js";
import websocket from "../../ws/plugin.js";
import daemonRegistryPlugin from "../../daemon-registry/plugin.js";
import copilotAggregatorPlugin from "../plugin.js";
import copilotSessionRoutes from "../../routes/copilot-sessions.js";

function createMockSocket() {
  const sent: string[] = [];
  return {
    sent,
    readyState: 1,
    OPEN: 1 as const,
    send(data: string) { sent.push(data); },
    on(_event: string, _handler: (...args: unknown[]) => void) {},
    close() {},
    terminate() {},
    ping() {},
  };
}

function makeDaemonInfo(projectId = "proj-1") {
  return {
    projectId,
    projectName: "Test Project",
    runtimeTarget: "local" as const,
    capabilities: [],
    version: "1.0.0",
    protocolVersion: "1.0.0" as const,
  };
}

describe("Copilot session routes", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await createTestServer();
    await server.register(websocket);
    await server.register(daemonRegistryPlugin);
    await server.register(copilotAggregatorPlugin);
    await server.register(copilotSessionRoutes);
  });

  afterEach(async () => {
    await server.close();
  });

  // ── GET /api/copilot/aggregated/sessions ──────────────

  describe("GET /api/copilot/aggregated/sessions", () => {
    it("returns empty session list initially", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessions).toEqual([]);
      expect(body.count).toBe(0);
    });

    it("returns aggregated sessions after update", async () => {
      server.copilotAggregator.updateSessions("test/repo1", "proj-1", [
        { sessionId: "s1", state: "active", startedAt: 1000, lastActivityAt: 2000 },
        { sessionId: "s2", state: "idle", startedAt: 1000, lastActivityAt: 3000 },
      ]);

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(2);
      expect(body.sessions[0]).toHaveProperty("sessionId");
      expect(body.sessions[0]).toHaveProperty("daemonId", "test/repo1");
    });
  });

  // ── GET /api/copilot/aggregated/sessions/:sessionId ───

  describe("GET /api/copilot/aggregated/sessions/:sessionId", () => {
    it("returns session detail", async () => {
      server.copilotAggregator.updateSessions("test/repo1", "proj-1", [
        { sessionId: "s1", state: "active", model: "gpt-4", startedAt: 1000, lastActivityAt: 2000 },
      ]);

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessionId).toBe("s1");
      expect(body.model).toBe("gpt-4");
    });

    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/nonexistent",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });
  });

  // ── GET /api/copilot/aggregated/sessions/:sessionId/messages ──

  describe("GET /api/copilot/aggregated/sessions/:sessionId/messages", () => {
    it("returns message history for a session", async () => {
      server.copilotAggregator.updateSessions("test/repo1", "proj-1", [
        { sessionId: "s1", state: "active", startedAt: 1000, lastActivityAt: 2000 },
      ]);
      server.copilotAggregator.appendMessages("s1", [
        { role: "user", content: "hello", timestamp: 1000 },
        { role: "assistant", content: "hi!", timestamp: 2000 },
      ]);

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/messages",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessionId).toBe("s1");
      expect(body.count).toBe(2);
      expect(body.messages[0].role).toBe("user");
    });

    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/nonexistent/messages",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/copilot/aggregated/sessions/:sessionId/send ──

  describe("POST /api/copilot/aggregated/sessions/:sessionId/send", () => {
    it("sends prompt to the correct daemon", async () => {
      // Register a mock daemon
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      // Seed session (must be idle to accept a new prompt)
      server.copilotAggregator.updateSessions("test/repo1", "proj-1", [
        { sessionId: "s1", state: "idle", startedAt: 1000, lastActivityAt: 2000 },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: { prompt: "fix the bug" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      // Check the message was sent to the daemon
      expect(ws.sent).toHaveLength(1);
      const sentMsg = JSON.parse(ws.sent[0]);
      expect(sentMsg.type).toBe("copilot-send-prompt");
      expect(sentMsg.payload.sessionId).toBe("s1");
      expect(sentMsg.payload.prompt).toBe("fix the bug");
    });

    it("returns 400 when prompt is missing", async () => {
      server.copilotAggregator.updateSessions("test/repo1", "proj-1", [
        { sessionId: "s1", state: "idle", startedAt: 1000, lastActivityAt: 2000 },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("bad_request");
    });

    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/nonexistent/send",
        payload: { prompt: "hello" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 502 when daemon is not connected", async () => {
      // Register a daemon then disconnect it (ws closed)
      const ws = createMockSocket();
      ws.readyState = 3; // CLOSED
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.updateSessions("test/repo1", "proj-1", [
        { sessionId: "s1", state: "idle", startedAt: 1000, lastActivityAt: 2000 },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: { prompt: "hello" },
      });

      expect(res.statusCode).toBe(502);
    });
  });

  // ── POST /api/copilot/aggregated/sessions/:sessionId/abort ──

  describe("POST /api/copilot/aggregated/sessions/:sessionId/abort", () => {
    it("sends abort to the correct daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.updateSessions("test/repo1", "proj-1", [
        { sessionId: "s1", state: "active", startedAt: 1000, lastActivityAt: 2000 },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/abort",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      expect(ws.sent).toHaveLength(1);
      const sentMsg = JSON.parse(ws.sent[0]);
      expect(sentMsg.type).toBe("copilot-abort-session");
      expect(sentMsg.payload.sessionId).toBe("s1");
    });

    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/nonexistent/abort",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/copilot/aggregated/sessions/:sessionId/tools ──

  describe("GET /api/copilot/aggregated/sessions/:sessionId/tools", () => {
    it("returns tool invocation history for a session", async () => {
      server.copilotAggregator.updateSessions("test/repo1", "proj-1", [
        { sessionId: "s1", state: "active", startedAt: 1000, lastActivityAt: 2000 },
      ]);
      server.copilotAggregator.handleToolInvocation(
        "s1", "proj-1", "report_progress",
        { status: "working", summary: "Making progress" }, 3000,
      );
      server.copilotAggregator.handleToolInvocation(
        "s1", "proj-1", "request_human_review",
        { reason: "Please check", urgency: "high" }, 4000,
      );

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/tools",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessionId).toBe("s1");
      expect(body.count).toBe(2);
      expect(body.invocations[0].tool).toBe("report_progress");
      expect(body.invocations[1].tool).toBe("request_human_review");
    });

    it("returns empty invocations for session with no tools used", async () => {
      server.copilotAggregator.updateSessions("test/repo1", "proj-1", [
        { sessionId: "s1", state: "active", startedAt: 1000, lastActivityAt: 2000 },
      ]);

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/tools",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(0);
      expect(body.invocations).toEqual([]);
    });

    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/nonexistent/tools",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });
  });

  // ── POST /api/daemons/:id/copilot/sessions ────────────

  describe("POST /api/daemons/:id/copilot/sessions", () => {
    it("sends create-session to the daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      const res = await server.inject({
        method: "POST",
        url: "/api/daemons/test/repo1/copilot/sessions",
        payload: { model: "gpt-4" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      expect(ws.sent).toHaveLength(1);
      const sentMsg = JSON.parse(ws.sent[0]);
      expect(sentMsg.type).toBe("copilot-create-session");
      expect(sentMsg.payload.requestId).toBeDefined();
      expect(sentMsg.payload.config).toEqual({ model: "gpt-4" });
    });

    it("returns 404 for unknown daemon", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/daemons/test/nonexistent/copilot/sessions",
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 502 when daemon socket is closed", async () => {
      const ws = createMockSocket();
      ws.readyState = 3; // CLOSED
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      const res = await server.inject({
        method: "POST",
        url: "/api/daemons/test/repo1/copilot/sessions",
        payload: {},
      });

      expect(res.statusCode).toBe(502);
    });
  });
});
