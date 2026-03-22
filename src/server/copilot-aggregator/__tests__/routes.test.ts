import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestServer, type FastifyInstance } from "../../../test-utils/server.js";
import websocket from "../../ws/plugin.js";
import terminalRelayPlugin from "../../terminal-relay/plugin.js";
import daemonRegistryPlugin from "../../daemon-registry/plugin.js";
import copilotAggregatorPlugin from "../plugin.js";
import copilotSessionRoutes from "../../routes/copilot-sessions.js";
import { defaultLaunchpadConfig } from "../../state/types.js";

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

function createMockStateService() {
  return {
    getConfig: vi.fn().mockResolvedValue({ version: 1, projects: [] }),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    getPreferences: vi.fn().mockResolvedValue({ version: 1, theme: "system" }),
    savePreferences: vi.fn().mockResolvedValue(undefined),
    getEnrichment: vi.fn().mockResolvedValue({
      version: 1,
      projects: {},
      updatedAt: new Date().toISOString(),
    }),
    saveEnrichment: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    getProjectByToken: vi.fn().mockResolvedValue(undefined),
    updateProjectState: vi.fn().mockResolvedValue(undefined),
    getProjectDefaultCopilotAgent: vi.fn().mockResolvedValue(undefined),
    updateProjectDefaultCopilotAgent: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Copilot session routes", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await createTestServer();
    server.decorate("stateService", createMockStateService());
    server.decorate("launchpadConfig", defaultLaunchpadConfig());
    await server.register(websocket);
    await server.register(terminalRelayPlugin);
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
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s2");

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(2);
      expect(body.sessions[0]).toHaveProperty("sessionId");
      expect(body.sessions[0]).not.toHaveProperty("daemonId");
    });
  });

  // ── GET /api/copilot/aggregated/sessions/:sessionId ───

  describe("GET /api/copilot/aggregated/sessions/:sessionId", () => {
    it("returns session detail", async () => {
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessionId).toBe("s1");
      expect(body.status).toBe("idle");
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
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");
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
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

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
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

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

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

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

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

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
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");
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
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

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

      const resPromise = server.inject({
        method: "POST",
        url: "/api/daemons/test/repo1/copilot/sessions",
        payload: { model: "gpt-4" },
      });

      // Wait a tick so the route sends the message and starts waiting
      await new Promise((r) => setTimeout(r, 10));

      expect(ws.sent).toHaveLength(1);
      const sentMsg = JSON.parse(ws.sent[0]);
      expect(sentMsg.type).toBe("copilot-create-session");
      expect(sentMsg.payload.requestId).toBeDefined();
      expect(sentMsg.payload.config).toEqual({ model: "gpt-4" });

      // Resolve the pending request
      server.copilotAggregator.resolveRequest(sentMsg.payload.requestId, { sessionId: "new-sess" });

      const res = await resPromise;
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, sessionId: "new-sess", sessionType: "copilot-sdk" });
    });

    it("lets an explicit agent selection override the remembered preference", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      const resPromise = server.inject({
        method: "POST",
        url: "/api/daemons/test/repo1/copilot/sessions",
        payload: { agent: "planner" },
      });

      await new Promise((r) => setTimeout(r, 10));

      const sentMsg = JSON.parse(ws.sent[0]);
      expect(sentMsg.payload.config).toEqual({ model: "claude-opus-4.6", agentId: "planner" });

      server.copilotAggregator.resolveRequest(sentMsg.payload.requestId, { sessionId: "new-sess-agent" });

      const res = await resPromise;
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, sessionId: "new-sess-agent", sessionType: "copilot-sdk" });
    });

    it("starts new SDK sessions on the default agent when none is provided", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      const resPromise = server.inject({
        method: "POST",
        url: "/api/daemons/test/repo1/copilot/sessions",
        payload: {},
      });

      await new Promise((r) => setTimeout(r, 10));

      const sentMsg = JSON.parse(ws.sent[0]);
      expect(sentMsg.payload.config).toEqual({ model: "claude-opus-4.6" });

      server.copilotAggregator.resolveRequest(sentMsg.payload.requestId, {
        sessionId: "new-sess-default",
      });

      const res = await resPromise;
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        ok: true,
        sessionId: "new-sess-default",
        sessionType: "copilot-sdk",
      });
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

  // ── Client-facing session stripping ───────────────────

  describe("session field stripping", () => {
    it("GET sessions does not include daemonId or projectId", async () => {
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessions[0]).not.toHaveProperty("daemonId");
      expect(body.sessions[0]).not.toHaveProperty("projectId");
      expect(body.sessions[0]).toHaveProperty("sessionId", "s1");
    });

    it("GET session detail does not include daemonId or projectId", async () => {
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).not.toHaveProperty("daemonId");
      expect(body).not.toHaveProperty("projectId");
    });
  });

  // ── POST /api/copilot/aggregated/sessions/:sessionId/resume ──

  describe("POST /api/copilot/aggregated/sessions/:sessionId/resume", () => {
    it("sends a resume message to the daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/resume",
        payload: { config: { model: "gpt-4o" } },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      expect(ws.sent).toHaveLength(1);
      const resumeMsg = JSON.parse(ws.sent[0]);
      expect(resumeMsg.type).toBe("copilot-resume-session");
      expect(resumeMsg.payload.sessionId).toBe("s1");
      expect(resumeMsg.payload.config).toEqual({ model: "gpt-4o" });
      expect(resumeMsg.payload.requestId).toBeDefined();
    });

    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/nonexistent/resume",
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/copilot/aggregated/sessions/:sessionId/set-model ──

  describe("POST /api/copilot/aggregated/sessions/:sessionId/set-model", () => {
    it("sends set-model message to daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/set-model",
        payload: { model: "gpt-4o" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-set-model");
      expect(msg.payload.model).toBe("gpt-4o");
    });

    it("returns 400 when model is missing", async () => {
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/set-model",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /api/copilot/aggregated/sessions/:sessionId/mode ──

  describe("POST /api/copilot/aggregated/sessions/:sessionId/mode", () => {
    it("sends set-mode message to daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/mode",
        payload: { mode: "autopilot" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-set-mode");
      expect(msg.payload.mode).toBe("autopilot");
    });

    it("returns 400 when mode is missing", async () => {
      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/mode",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /api/copilot/aggregated/sessions/:sessionId/mode ──

  describe("GET /api/copilot/aggregated/sessions/:sessionId/mode", () => {
    it("sends get-mode to daemon and returns response", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      // Simulate daemon response in background
      const responsePromise = server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/mode",
      });

      // Wait briefly for the message to be sent
      await new Promise((r) => setTimeout(r, 50));

      // Extract requestId from sent message and resolve
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-get-mode");
      server.copilotAggregator.resolveRequest(msg.payload.requestId, { mode: "interactive" });

      const res = await responsePromise;
      expect(res.statusCode).toBe(200);
      expect(res.json().mode).toBe("interactive");
    });

    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/nonexistent/mode",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── Agent routes ───────────────────────────────────────

  describe("session agent routes", () => {
    it("GET /api/copilot/aggregated/sessions/:sessionId/agent queries the daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const responsePromise = server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/agent",
      });

      await new Promise((r) => setTimeout(r, 50));

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-get-agent");
      server.copilotAggregator.resolveRequest(msg.payload.requestId, {
        sessionId: "s1",
        agentId: "planner",
        agentName: "Planner",
      });

      const res = await responsePromise;
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        sessionId: "s1",
        agentId: "planner",
        agentName: "Planner",
      });
    });

    it("POST /api/copilot/aggregated/sessions/:sessionId/agent switches the daemon agent", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const responsePromise = server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/agent",
        payload: { agentId: "planner" },
      });

      await new Promise((r) => setTimeout(r, 50));

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-set-agent");
      expect(msg.payload.agentId).toBe("planner");
      server.copilotAggregator.resolveRequest(msg.payload.requestId, {
        sessionId: "s1",
        agentId: "planner",
        agentName: "Planner",
      });

      const res = await responsePromise;
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        sessionId: "s1",
        agentId: "planner",
        agentName: "Planner",
      });
    });
  });

  // ── Plan routes ───────────────────────────────────────

  describe("plan routes", () => {
    it("POST plan sends update-plan to daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/plan",
        payload: { content: "Step 1: Do the thing" },
      });

      expect(res.statusCode).toBe(200);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-update-plan");
      expect(msg.payload.content).toBe("Step 1: Do the thing");
    });

    it("DELETE plan sends delete-plan to daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "DELETE",
        url: "/api/copilot/aggregated/sessions/s1/plan",
      });

      expect(res.statusCode).toBe(200);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-delete-plan");
      expect(msg.payload.sessionId).toBe("s1");
    });

    it("GET plan sends get-plan to daemon and returns response", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const responsePromise = server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/plan",
      });

      await new Promise((r) => setTimeout(r, 50));

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-get-plan");
      server.copilotAggregator.resolveRequest(msg.payload.requestId, {
        plan: { exists: true, content: "My plan", path: "plan.md" },
      });

      const res = await responsePromise;
      expect(res.statusCode).toBe(200);
      expect(res.json().plan.content).toBe("My plan");
    });
  });

  // ── POST /api/copilot/aggregated/sessions/:sessionId/disconnect ──

  describe("POST /api/copilot/aggregated/sessions/:sessionId/disconnect", () => {
    it("sends disconnect to daemon", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      server.copilotAggregator.trackNewSession("test/repo1", "proj-1", "s1");

      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/s1/disconnect",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-disconnect-session");
      expect(msg.payload.sessionId).toBe("s1");
    });

    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/copilot/aggregated/sessions/nonexistent/disconnect",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/copilot/models ───────────────────────────

  describe("GET /api/copilot/models", () => {
    it("returns 503 when no daemons connected", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/models",
      });

      expect(res.statusCode).toBe(503);
    });

    it("sends list-models to daemon and returns response", async () => {
      const ws = createMockSocket();
      server.daemonRegistry.register("test/repo1", ws as never, makeDaemonInfo());

      const responsePromise = server.inject({
        method: "GET",
        url: "/api/copilot/models",
      });

      await new Promise((r) => setTimeout(r, 50));

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("copilot-list-models");
      server.copilotAggregator.resolveRequest(msg.payload.requestId, {
        models: [{ id: "gpt-4o", name: "GPT-4o" }],
      });

      const res = await responsePromise;
      expect(res.statusCode).toBe(200);
      expect(res.json().models).toHaveLength(1);
      expect(res.json().models[0].id).toBe("gpt-4o");
    });
  });

  // ── GET /api/copilot/aggregated/sessions/:sessionId/events ──

  describe("GET /api/copilot/aggregated/sessions/:sessionId/events", () => {
    it("returns 404 for unknown session", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/nonexistent/events",
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });

    it("returns empty events for a session with no events", async () => {
      server.copilotAggregator.trackNewSession("d1", "proj-1", "s1");

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/events",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toEqual([]);
      expect(body.hasMore).toBe(false);
      expect(body.oldestTimestamp).toBeNull();
    });

    it("returns stored session events", async () => {
      server.copilotAggregator.trackNewSession("d1", "proj-1", "s1");
      server.copilotAggregator.handleSessionEvent("d1", "s1", {
        id: "evt-1",
        timestamp: new Date(5000).toISOString(),
        parentId: null,
        type: "session.start",
        data: {},
      } as import("@github/copilot-sdk").SessionEvent);

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/events",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toHaveLength(1);
      expect(body.events[0].type).toBe("session.start");
      expect(body.events[0].id).toBe("evt-1");
    });

    it("respects limit query parameter", async () => {
      server.copilotAggregator.trackNewSession("d1", "proj-1", "s1");
      for (let i = 0; i < 10; i++) {
        server.copilotAggregator.handleSessionEvent("d1", "s1", {
          id: `evt-${i}`,
          timestamp: new Date(1000 + i * 100).toISOString(),
          parentId: null,
          type: "user.message",
          data: { index: i },
        } as import("@github/copilot-sdk").SessionEvent);
      }

      const res = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/events?limit=3",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toHaveLength(3);
      expect(body.hasMore).toBe(true);
    });

    it("paginates with before cursor", async () => {
      server.copilotAggregator.trackNewSession("d1", "proj-1", "s1");
      for (let i = 0; i < 10; i++) {
        server.copilotAggregator.handleSessionEvent("d1", "s1", {
          id: `evt-${i}`,
          timestamp: new Date(1000 + i * 100).toISOString(),
          parentId: null,
          type: "user.message",
          data: { index: i },
        } as import("@github/copilot-sdk").SessionEvent);
      }

      // Get page 1
      const res1 = await server.inject({
        method: "GET",
        url: "/api/copilot/aggregated/sessions/s1/events?limit=3",
      });
      const page1 = res1.json();
      expect(page1.events).toHaveLength(3);

      // Get page 2 using cursor
      const res2 = await server.inject({
        method: "GET",
        url: `/api/copilot/aggregated/sessions/s1/events?limit=3&before=${encodeURIComponent(page1.oldestTimestamp)}`,
      });
      const page2 = res2.json();
      expect(page2.events).toHaveLength(3);
      // Events should be older than page 1
      expect(new Date(page2.events[2].timestamp).getTime()).toBeLessThan(
        new Date(page1.events[0].timestamp).getTime()
      );
    });
  });
});
