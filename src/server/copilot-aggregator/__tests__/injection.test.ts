import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestServer,
  type FastifyInstance,
} from "../../../test-utils/server.js";
import websocket from "../../ws/plugin.js";
import daemonRegistryPlugin from "../../daemon-registry/plugin.js";
import copilotAggregatorPlugin from "../plugin.js";
import copilotSessionRoutes from "../../routes/copilot-sessions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSocket() {
  const sent: string[] = [];
  return {
    sent,
    readyState: 1,
    OPEN: 1 as const,
    send(data: string) {
      sent.push(data);
    },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Copilot prompt injection pipeline", () => {
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

  // ── Send prompt — happy path ────────────────────────────

  describe("send prompt — happy path", () => {
    it("sends prompt to daemon and records it in message history", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("d1", ws as never, makeDaemonInfo());
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "idle",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: { prompt: "explain this code" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      // Verify daemon received the message
      expect(ws.sent).toHaveLength(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-send-prompt");
      expect(msg.payload.sessionId).toBe("s1");
      expect(msg.payload.prompt).toBe("explain this code");

      // Verify prompt recorded in conversation history with source tag
      const messages = server.copilotAggregator.getMessages("s1");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: "user",
        content: "explain this code",
        source: "hq-injection",
      });
      expect(messages[0].timestamp).toBeGreaterThan(0);
    });
  });

  // ── Send prompt — error cases ───────────────────────────

  describe("send prompt — error cases", () => {
    it("returns 404 when session does not exist", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/nonexistent/send",
        payload: { prompt: "hello" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });

    it("returns 400 when prompt is empty string", async () => {
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "idle",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: { prompt: "" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("bad_request");
    });

    it("returns 400 when prompt field is missing", async () => {
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "idle",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 502 when daemon is disconnected", async () => {
      const ws = createMockSocket();
      ws.readyState = 3; // CLOSED
      server.daemonRegistry.register("d1", ws as never, makeDaemonInfo());
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "idle",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: { prompt: "hello" },
      });

      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe("send_failed");
    });

    it("returns 409 when session is currently active", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("d1", ws as never, makeDaemonInfo());
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "active",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: { prompt: "hello" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("conflict");

      // No message should have been sent to the daemon
      expect(ws.sent).toHaveLength(0);
    });
  });

  // ── Abort — happy path ─────────────────────────────────

  describe("abort — happy path", () => {
    it("sends abort to the correct daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("d1", ws as never, makeDaemonInfo());
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "active",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/abort",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      expect(ws.sent).toHaveLength(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-abort-session");
      expect(msg.payload.sessionId).toBe("s1");
    });
  });

  // ── Abort — error cases ────────────────────────────────

  describe("abort — error cases", () => {
    it("returns 404 when session does not exist", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/nonexistent/abort",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });

    it("succeeds even when daemon is disconnected (cleans up aggregator)", async () => {
      const ws = createMockSocket();
      ws.readyState = 3; // CLOSED
      server.daemonRegistry.register("d1", ws as never, makeDaemonInfo());
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "active",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/abort",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(server.copilotAggregator.getSession("s1")).toBeUndefined();
    });
  });

  // ── Message history with source tracking ───────────────

  describe("message history with source tracking", () => {
    it("records hq-injection source on injected prompts", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("d1", ws as never, makeDaemonInfo());
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "idle",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      // Inject a prompt
      await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: { prompt: "injected prompt" },
      });

      // Also add a normal message (simulating what the daemon would send)
      server.copilotAggregator.appendMessages("s1", [
        { role: "assistant", content: "response from copilot", timestamp: Date.now() },
      ]);

      // Fetch the message history
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/messages",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(2);

      // First message: injected prompt with source tag
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[0].content).toBe("injected prompt");
      expect(body.messages[0].source).toBe("hq-injection");

      // Second message: normal assistant message without source tag
      expect(body.messages[1].role).toBe("assistant");
      expect(body.messages[1].source).toBeUndefined();
    });

    it("does not record prompt when session not found", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/nonexistent/send",
        payload: { prompt: "test" },
      });

      expect(res.statusCode).toBe(404);
      // No messages should have been recorded
      expect(server.copilotAggregator.getMessages("nonexistent")).toEqual([]);
    });
  });

  // ── Session status lifecycle ───────────────────────────

  describe("session status lifecycle", () => {
    it("updates status to idle on session.start events (session is ready for input)", () => {
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "active",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      server.copilotAggregator.handleSessionEvent("d1", "s1", {
        type: "session.start",
        data: {},
        timestamp: Date.now(),
      });

      const session = server.copilotAggregator.getSession("s1");
      expect(session?.status).toBe("idle");
    });

    it("updates status to idle on session.idle events", () => {
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "active",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      server.copilotAggregator.handleSessionEvent("d1", "s1", {
        type: "session.idle",
        data: {},
        timestamp: Date.now(),
      });

      const session = server.copilotAggregator.getSession("s1");
      expect(session?.status).toBe("idle");
    });

    it("updates status to error on session.error events", () => {
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "active",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      server.copilotAggregator.handleSessionEvent("d1", "s1", {
        type: "session.error",
        data: { error: "something broke" },
        timestamp: Date.now(),
      });

      const session = server.copilotAggregator.getSession("s1");
      expect(session?.status).toBe("error");
    });

    it("allows sending prompt after session transitions from active to idle", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("d1", ws as never, makeDaemonInfo());
      server.copilotAggregator.updateSessions("d1", "proj-1", [
        {
          sessionId: "s1",
          state: "active",
          startedAt: 1000,
          lastActivityAt: 2000,
        },
      ]);

      // Session is active — should be rejected
      const res1 = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: { prompt: "hello" },
      });
      expect(res1.statusCode).toBe(409);

      // Session goes idle via event
      server.copilotAggregator.handleSessionEvent("d1", "s1", {
        type: "session.idle",
        data: {},
        timestamp: Date.now(),
      });

      // Now prompt should succeed
      const res2 = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/send",
        payload: { prompt: "hello" },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().ok).toBe(true);
    });
  });
});
