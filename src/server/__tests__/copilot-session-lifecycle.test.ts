import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestServer,
  type FastifyInstance,
} from "../../test-utils/server.js";
import websocket from "../ws/plugin.js";
import daemonRegistryPlugin from "../daemon-registry/plugin.js";
import copilotAggregatorPlugin from "../copilot-aggregator/plugin.js";
import copilotSessionRoutes from "../routes/copilot-sessions.js";

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

function makeDaemonInfo(projectId = "acme/widget") {
  return {
    projectId,
    projectName: projectId.split("/")[1] ?? "test-project",
    runtimeTarget: "local" as const,
    capabilities: [],
    version: "1.0.0",
    protocolVersion: "1.0.0" as const,
  };
}

function makeSessionInfo(overrides: Partial<{ sessionId: string; state: string; startedAt: number; lastActivityAt: number; model: string }> = {}) {
  return {
    sessionId: "sess-1",
    state: "idle" as const,
    startedAt: 1000,
    lastActivityAt: 2000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test server builder
// ---------------------------------------------------------------------------

async function buildServer() {
  const server = await createTestServer();
  await server.register(websocket);
  await server.register(daemonRegistryPlugin);
  await server.register(copilotAggregatorPlugin);
  await server.register(copilotSessionRoutes);
  return server;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Copilot session lifecycle — integration", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  // ══════════════════════════════════════════════════════════
  // 1. Session creation flow
  // ══════════════════════════════════════════════════════════

  describe("session creation via daemon", () => {
    it("sends copilot-create-session to daemon when POST to /api/daemons/:owner/:repo/copilot/sessions", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));

      const res = await server.inject({
        method: "POST",
        url: "/api/daemons/acme/widget/copilot/sessions",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      expect(ws.sent).toHaveLength(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-create-session");
      expect(msg.payload.requestId).toBeDefined();
    });

    it("forwards model config when specified", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));

      const res = await server.inject({
        method: "POST",
        url: "/api/daemons/acme/widget/copilot/sessions",
        payload: { model: "gpt-4o" },
      });

      expect(res.statusCode).toBe(200);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.payload.config).toEqual({ model: "gpt-4o" });
    });

    it("returns 404 when daemon does not exist", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/daemons/no-org/no-repo/copilot/sessions",
        payload: {},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });

    it("returns 502 when daemon socket is closed", async () => {
      const ws = createMockSocket();
      ws.readyState = 3; // CLOSED
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));

      const res = await server.inject({
        method: "POST",
        url: "/api/daemons/acme/widget/copilot/sessions",
        payload: {},
      });

      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe("send_failed");
    });
  });

  // ══════════════════════════════════════════════════════════
  // 2. Session status lifecycle through events
  // ══════════════════════════════════════════════════════════

  describe("session status transitions via events", () => {
    beforeEach(() => {
      // Seed an active session so we can test transitions
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "sess-lifecycle", state: "active" }),
      ]);
    });

    it("session.start → status becomes idle (ready for input)", () => {
      server.copilotAggregator.handleSessionEvent("acme/widget", "sess-lifecycle", {
        type: "session.start",
        data: {},
        timestamp: Date.now(),
      });

      expect(server.copilotAggregator.getSession("sess-lifecycle")?.status).toBe("idle");
    });

    it("user.message → status becomes active", () => {
      // First go idle
      server.copilotAggregator.handleSessionEvent("acme/widget", "sess-lifecycle", {
        type: "session.start",
        data: {},
        timestamp: Date.now(),
      });
      expect(server.copilotAggregator.getSession("sess-lifecycle")?.status).toBe("idle");

      // User sends message
      server.copilotAggregator.handleSessionEvent("acme/widget", "sess-lifecycle", {
        type: "user.message",
        data: { content: "hello" },
        timestamp: Date.now(),
      });

      expect(server.copilotAggregator.getSession("sess-lifecycle")?.status).toBe("active");
    });

    it("assistant.message → status returns to idle", () => {
      server.copilotAggregator.handleSessionEvent("acme/widget", "sess-lifecycle", {
        type: "assistant.message",
        data: { content: "here is the answer" },
        timestamp: Date.now(),
      });

      expect(server.copilotAggregator.getSession("sess-lifecycle")?.status).toBe("idle");
    });

    it("session.error → status becomes error", () => {
      server.copilotAggregator.handleSessionEvent("acme/widget", "sess-lifecycle", {
        type: "session.error",
        data: { error: "rate limit exceeded" },
        timestamp: Date.now(),
      });

      expect(server.copilotAggregator.getSession("sess-lifecycle")?.status).toBe("error");
    });

    it("session.idle → status becomes idle", () => {
      server.copilotAggregator.handleSessionEvent("acme/widget", "sess-lifecycle", {
        type: "session.idle",
        data: {},
        timestamp: Date.now(),
      });

      expect(server.copilotAggregator.getSession("sess-lifecycle")?.status).toBe("idle");
    });

    it("full lifecycle: start → user.message → assistant.message.delta → assistant.message", () => {
      const session = () => server.copilotAggregator.getSession("sess-lifecycle");
      const fire = (type: string) =>
        server.copilotAggregator.handleSessionEvent("acme/widget", "sess-lifecycle", {
          type: type as never,
          data: {},
          timestamp: Date.now(),
        });

      fire("session.start");
      expect(session()?.status).toBe("idle");

      fire("user.message");
      expect(session()?.status).toBe("active");

      fire("assistant.message.delta");
      expect(session()?.status).toBe("active"); // still active during streaming

      fire("assistant.message");
      expect(session()?.status).toBe("idle"); // done → back to idle
    });

    it("lastEvent is updated on each event", () => {
      const before = Date.now();

      server.copilotAggregator.handleSessionEvent("acme/widget", "sess-lifecycle", {
        type: "user.message",
        data: {},
        timestamp: before,
      });

      const session = server.copilotAggregator.getSession("sess-lifecycle");
      expect(session?.lastEvent).toEqual({ type: "user.message", timestamp: before });
    });
  });

  // ══════════════════════════════════════════════════════════
  // 3. Send prompt flow
  // ══════════════════════════════════════════════════════════

  describe("send prompt to session", () => {
    it("sends copilot-send-prompt to daemon and returns 200 for idle session", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-prompt", state: "idle" }),
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-prompt/send",
        payload: { prompt: "refactor this function" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-send-prompt");
      expect(msg.payload.sessionId).toBe("s-prompt");
      expect(msg.payload.prompt).toBe("refactor this function");
    });

    it("returns 409 Conflict when session is active", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-active", state: "active" }),
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-active/send",
        payload: { prompt: "hello" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("conflict");
      expect(ws.sent).toHaveLength(0);
    });

    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/no-such-session/send",
        payload: { prompt: "hello" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when prompt is missing", async () => {
      server.copilotAggregator.updateSessions("d1", "p1", [
        makeSessionInfo({ sessionId: "s-noprompt", state: "idle" }),
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-noprompt/send",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("bad_request");
    });

    it("records injected prompt in conversation history with hq-injection source", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-history", state: "idle" }),
      ]);

      await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-history/send",
        payload: { prompt: "track this" },
      });

      const messages = server.copilotAggregator.getMessages("s-history");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: "user",
        content: "track this",
        source: "hq-injection",
      });
    });
  });

  // ══════════════════════════════════════════════════════════
  // 4. Abort/End session flow
  // ══════════════════════════════════════════════════════════

  describe("abort session", () => {
    it("sends copilot-abort-session to the correct daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-abort", state: "active" }),
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-abort/abort",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-abort-session");
      expect(msg.payload.sessionId).toBe("s-abort");
    });

    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/ghost-session/abort",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });

    it("succeeds even when daemon is disconnected (cleans up aggregator)", async () => {
      const ws = createMockSocket();
      ws.readyState = 3;
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-dead", state: "active" }),
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-dead/abort",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(server.copilotAggregator.getSession("s-dead")).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════
  // 5. ProjectId injection (regression test)
  // ══════════════════════════════════════════════════════════

  describe("projectId injection — regression", () => {
    it("sessions created via updateSessions carry the correct projectId", () => {
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-proj" }),
      ]);

      const session = server.copilotAggregator.getSession("s-proj");
      expect(session?.projectId).toBe("acme/widget");
      expect(session?.projectId).not.toBe("unknown");
    });

    it("stub sessions created by handleSessionEvent use daemonId as projectId", () => {
      // No prior session-list — event arrives for an unknown session
      server.copilotAggregator.handleSessionEvent("acme/widget", "s-stub", {
        type: "session.start",
        data: {},
        timestamp: Date.now(),
      });

      const session = server.copilotAggregator.getSession("s-stub");
      expect(session).toBeDefined();
      expect(session?.projectId).toBe("acme/widget");
      expect(session?.projectId).not.toBe("unknown");
    });

    it("sessions from different daemons have distinct projectIds", () => {
      const ws1 = createMockSocket();
      const ws2 = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws1 as never, makeDaemonInfo("acme/widget"));
      server.daemonRegistry.register("acme/gizmo", ws2 as never, makeDaemonInfo("acme/gizmo"));

      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "sw-1" }),
      ]);
      server.copilotAggregator.updateSessions("acme/gizmo", "acme/gizmo", [
        makeSessionInfo({ sessionId: "sg-1" }),
      ]);

      expect(server.copilotAggregator.getSession("sw-1")?.projectId).toBe("acme/widget");
      expect(server.copilotAggregator.getSession("sg-1")?.projectId).toBe("acme/gizmo");
    });

    it("copilot:session-event emitted by registry propagates projectId through aggregator", () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));

      // Simulate what DaemonWsHandler does for copilot-sdk-session-event:
      // It emits "copilot:session-event" on the registry with daemonId and payload
      server.daemonRegistry.emit(
        "copilot:session-event" as never,
        "acme/widget",
        {
          projectId: "acme/widget",
          sessionId: "s-evt",
          event: { type: "session.start", data: {}, timestamp: Date.now() },
        },
      );

      const session = server.copilotAggregator.getSession("s-evt");
      expect(session).toBeDefined();
      expect(session?.projectId).toBe("acme/widget");
      expect(session?.daemonId).toBe("acme/widget");
    });
  });

  // ══════════════════════════════════════════════════════════
  // 6. Aggregated sessions list and filtering
  // ══════════════════════════════════════════════════════════

  describe("aggregated sessions listing", () => {
    it("GET /api/copilot/aggregated/sessions returns all sessions", async () => {
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s1" }),
        makeSessionInfo({ sessionId: "s2" }),
      ]);
      server.copilotAggregator.updateSessions("acme/gizmo", "acme/gizmo", [
        makeSessionInfo({ sessionId: "s3" }),
      ]);

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(3);
      expect(body.sessions).toHaveLength(3);

      const ids = body.sessions.map((s: { sessionId: string }) => s.sessionId).sort();
      expect(ids).toEqual(["s1", "s2", "s3"]);
    });

    it("sessions are correctly associated with their project", async () => {
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "sw-1" }),
      ]);
      server.copilotAggregator.updateSessions("acme/gizmo", "acme/gizmo", [
        makeSessionInfo({ sessionId: "sg-1" }),
      ]);

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions",
      });

      const body = res.json();
      const widgetSession = body.sessions.find((s: { sessionId: string }) => s.sessionId === "sw-1");
      const gizmoSession = body.sessions.find((s: { sessionId: string }) => s.sessionId === "sg-1");

      expect(widgetSession.projectId).toBe("acme/widget");
      expect(gizmoSession.projectId).toBe("acme/gizmo");
    });

    it("GET /api/copilot/aggregated/sessions/:id returns single session detail", async () => {
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-detail", model: "gpt-4o" }),
      ]);

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s-detail",
      });

      expect(res.statusCode).toBe(200);
      const session = res.json();
      expect(session.sessionId).toBe("s-detail");
      expect(session.projectId).toBe("acme/widget");
      expect(session.model).toBe("gpt-4o");
    });

    it("GET /api/copilot/aggregated/sessions/:id returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/nonexistent",
      });

      expect(res.statusCode).toBe(404);
    });

    it("sessions are cleaned up when daemon disconnects", () => {
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-cleanup" }),
      ]);

      expect(server.copilotAggregator.getSession("s-cleanup")).toBeDefined();

      // Simulate daemon disconnect
      server.copilotAggregator.removeDaemon("acme/widget");

      expect(server.copilotAggregator.getSession("s-cleanup")).toBeUndefined();
      expect(server.copilotAggregator.getAllSessions()).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════
  // 7. Message and tool history routes
  // ══════════════════════════════════════════════════════════

  describe("message and tool history endpoints", () => {
    it("GET /api/copilot/aggregated/sessions/:id/messages returns conversation history", async () => {
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-msgs" }),
      ]);
      server.copilotAggregator.appendMessages("s-msgs", [
        { role: "user", content: "hello", timestamp: 1000 },
        { role: "assistant", content: "hi there", timestamp: 2000 },
      ]);

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s-msgs/messages",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(2);
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[1].role).toBe("assistant");
    });

    it("GET /api/copilot/aggregated/sessions/:id/messages returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/nonexistent/messages",
      });

      expect(res.statusCode).toBe(404);
    });

    it("GET /api/copilot/aggregated/sessions/:id/tools returns tool invocations", async () => {
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-tools" }),
      ]);
      server.copilotAggregator.handleToolInvocation(
        "s-tools",
        "acme/widget",
        "report_progress",
        { status: "in_progress", summary: "working" },
        Date.now(),
      );

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s-tools/tools",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(1);
      expect(body.invocations[0].tool).toBe("report_progress");
    });

    it("GET /api/copilot/aggregated/sessions/:id/tools returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/nonexistent/tools",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════
  // 8. Multi-daemon routing
  // ══════════════════════════════════════════════════════════

  describe("multi-daemon routing", () => {
    it("send prompt reaches the correct daemon when multiple are connected", async () => {
      const ws1 = createMockSocket();
      const ws2 = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws1 as never, makeDaemonInfo("acme/widget"));
      server.daemonRegistry.register("acme/gizmo", ws2 as never, makeDaemonInfo("acme/gizmo"));

      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-w1" }),
      ]);
      server.copilotAggregator.updateSessions("acme/gizmo", "acme/gizmo", [
        makeSessionInfo({ sessionId: "s-g1" }),
      ]);

      // Send to widget session
      await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-w1/send",
        payload: { prompt: "for widget" },
      });

      // Send to gizmo session
      await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-g1/send",
        payload: { prompt: "for gizmo" },
      });

      // Widget daemon got the widget prompt
      expect(ws1.sent).toHaveLength(1);
      expect(JSON.parse(ws1.sent[0]).payload.prompt).toBe("for widget");

      // Gizmo daemon got the gizmo prompt
      expect(ws2.sent).toHaveLength(1);
      expect(JSON.parse(ws2.sent[0]).payload.prompt).toBe("for gizmo");
    });

    it("abort reaches the correct daemon", async () => {
      const ws1 = createMockSocket();
      const ws2 = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws1 as never, makeDaemonInfo("acme/widget"));
      server.daemonRegistry.register("acme/gizmo", ws2 as never, makeDaemonInfo("acme/gizmo"));

      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-wa", state: "active" }),
      ]);
      server.copilotAggregator.updateSessions("acme/gizmo", "acme/gizmo", [
        makeSessionInfo({ sessionId: "s-ga", state: "active" }),
      ]);

      await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-wa/abort",
      });

      // Only widget daemon received the abort
      expect(ws1.sent).toHaveLength(1);
      expect(JSON.parse(ws1.sent[0]).type).toBe("copilot-abort-session");
      expect(ws2.sent).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════
  // 9. Session removal
  // ══════════════════════════════════════════════════════════

  describe("session removal", () => {
    it("removeSession deletes session, conversation history, and tool invocations", () => {
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-rm" }),
      ]);
      server.copilotAggregator.appendMessages("s-rm", [
        { role: "user", content: "hello", timestamp: 1000 },
      ]);

      expect(server.copilotAggregator.getSession("s-rm")).toBeDefined();
      expect(server.copilotAggregator.getMessages("s-rm")).toHaveLength(1);

      server.copilotAggregator.removeSession("s-rm");

      expect(server.copilotAggregator.getSession("s-rm")).toBeUndefined();
      expect(server.copilotAggregator.getMessages("s-rm")).toHaveLength(0);
      expect(server.copilotAggregator.getAllSessions()).toHaveLength(0);
    });

    it("removeSession emits sessions-updated", () => {
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-emit" }),
      ]);

      let emitted = false;
      server.copilotAggregator.on("sessions-updated", () => { emitted = true; });

      server.copilotAggregator.removeSession("s-emit");
      expect(emitted).toBe(true);
    });

    it("removeSession is a no-op for unknown session (no event emitted)", () => {
      let emitted = false;
      server.copilotAggregator.on("sessions-updated", () => { emitted = true; });

      server.copilotAggregator.removeSession("nonexistent");
      expect(emitted).toBe(false);
    });

    it("session.ended event removes session from aggregator", () => {
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-ended" }),
      ]);
      expect(server.copilotAggregator.getSession("s-ended")).toBeDefined();

      server.copilotAggregator.handleSessionEvent("acme/widget", "s-ended", {
        type: "session.ended",
        data: {},
        timestamp: Date.now(),
      });

      expect(server.copilotAggregator.getSession("s-ended")).toBeUndefined();
    });

    it("session.ended for unknown session does not create a stub", () => {
      server.copilotAggregator.handleSessionEvent("acme/widget", "ghost", {
        type: "session.ended",
        data: {},
        timestamp: Date.now(),
      });

      expect(server.copilotAggregator.getSession("ghost")).toBeUndefined();
    });

    it("abort route removes session from aggregator", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-abort-rm", state: "active" }),
      ]);

      expect(server.copilotAggregator.getSession("s-abort-rm")).toBeDefined();

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-abort-rm/abort",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(server.copilotAggregator.getSession("s-abort-rm")).toBeUndefined();
    });

    it("abort route succeeds even when daemon is disconnected", async () => {
      const ws = createMockSocket();
      ws.readyState = 3; // CLOSED
      server.daemonRegistry.register("acme/widget", ws as never, makeDaemonInfo("acme/widget"));
      server.copilotAggregator.updateSessions("acme/widget", "acme/widget", [
        makeSessionInfo({ sessionId: "s-dead-abort", state: "active" }),
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s-dead-abort/abort",
      });

      // Should succeed (200), NOT 502 — session is cleaned up regardless
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(server.copilotAggregator.getSession("s-dead-abort")).toBeUndefined();
    });
  });
});
