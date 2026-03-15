import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestServer, type FastifyInstance } from "../../test-utils/server.js";
import { DaemonRegistry } from "../daemon-registry/registry.js";
import { DaemonWsHandler, type TokenLookup, type BrowserBroadcast } from "../daemon-registry/handler.js";
import type { DaemonInfo, DaemonToHqMessage, HqToDaemonMessage } from "../../shared/protocol.js";
import { HEARTBEAT_TIMEOUT_MS, WS_CLOSE_AUTH_REJECTED } from "../../shared/constants.js";
import daemonRoutes from "../routes/daemons.js";

/** Flush the microtask queue so async auth handling completes. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// --- Mock helpers ---

function createMockSocket() {
  const sent: string[] = [];
  let lastCloseCode: number | undefined;
  let lastCloseReason: string | undefined;
  let closeHandler: (() => void) | null = null;
  let messageHandler: ((data: string) => void) | null = null;
  let errorHandler: ((err: Error) => void) | null = null;
  return {
    sent,
    readyState: 1,
    OPEN: 1 as const,
    get lastCloseCode() { return lastCloseCode; },
    get lastCloseReason() { return lastCloseReason; },
    send(data: string) {
      sent.push(data);
    },
    close(code?: number, reason?: string) {
      lastCloseCode = code;
      lastCloseReason = reason;
      if (closeHandler) closeHandler();
    },
    terminate() {},
    ping() {},
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "close") closeHandler = handler as () => void;
      if (event === "message") messageHandler = handler as (data: string) => void;
      if (event === "error") errorHandler = handler as (err: Error) => void;
    },
    // Test helpers to simulate events
    simulateMessage(data: string) {
      if (messageHandler) messageHandler(data);
    },
    simulateClose() {
      if (closeHandler) closeHandler();
    },
    simulateError(err: Error) {
      if (errorHandler) errorHandler(err);
    },
  };
}

function createMockLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child() {
      return createMockLog();
    },
    silent() {},
    level: "silent",
  };
}

function makeDaemonInfo(overrides?: Partial<DaemonInfo>): DaemonInfo {
  return {
    projectId: "proj-1",
    projectName: "Test Project",
    runtimeTarget: "local",
    capabilities: ["terminal", "copilot"],
    version: "0.1.0",
    protocolVersion: "1.0.0" as DaemonInfo["protocolVersion"],
    ...overrides,
  };
}

function createMockStateService(initialPreferences: Record<string, string | null> = { "test/repo1": null }) {
  const preferences = new Map(Object.entries(initialPreferences));

  return {
    getProjectDefaultCopilotAgent: vi.fn().mockImplementation(async (owner: string, repo: string) => {
      const key = `${owner}/${repo}`;
      return preferences.has(key) ? preferences.get(key) ?? null : undefined;
    }),
    updateProjectDefaultCopilotAgent: vi.fn().mockImplementation(async (owner: string, repo: string, agent: string | null) => {
      const key = `${owner}/${repo}`;
      if (!preferences.has(key)) return undefined;
      preferences.set(key, agent);
      return {
        owner,
        repo,
        addedAt: "2026-01-01T00:00:00Z",
        runtimeTarget: "local",
        initialized: true,
        daemonToken: "test-token",
        workState: "working",
        defaultCopilotSdkAgent: agent,
      };
    }),
  };
}

// --- DaemonRegistry tests ---

describe("DaemonRegistry", () => {
  let registry: DaemonRegistry;

  beforeEach(() => {
    registry = new DaemonRegistry();
  });

  afterEach(() => {
    registry.stopHeartbeatMonitor();
  });

  it("registers and retrieves a daemon", () => {
    const ws = createMockSocket();
    const info = makeDaemonInfo();
    registry.register("test/repo1", ws as never, info);

    expect(registry.size).toBe(1);
    const daemon = registry.getDaemon("test/repo1");
    expect(daemon).toBeDefined();
    expect(daemon!.info.projectName).toBe("Test Project");
    expect(daemon!.state).toBe("connected");
  });

  it("unregisters a daemon and emits event", () => {
    const ws = createMockSocket();
    registry.register("test/repo1", ws as never, makeDaemonInfo());

    const disconnected = vi.fn();
    registry.on("daemon:disconnected", disconnected);

    const summary = registry.unregister("test/repo1");
    expect(summary).toBeDefined();
    expect(summary!.state).toBe("disconnected");
    expect(registry.size).toBe(0);
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it("unregister returns undefined for unknown id", () => {
    expect(registry.unregister("ghost")).toBeUndefined();
  });

  it("getAllDaemons returns summaries", () => {
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();
    registry.register("test/repo1", ws1 as never, makeDaemonInfo({ projectId: "p1", projectName: "P1" }));
    registry.register("d2", ws2 as never, makeDaemonInfo({ projectId: "p2", projectName: "P2" }));

    const all = registry.getAllDaemons();
    expect(all).toHaveLength(2);
    expect(all.map((d) => d.projectName).sort()).toEqual(["P1", "P2"]);
    // Should not have ws property (serialisable)
    expect(all[0]).not.toHaveProperty("ws");
  });

  it("emits daemon:connected on register", () => {
    const connected = vi.fn();
    registry.on("daemon:connected", connected);

    const ws = createMockSocket();
    registry.register("test/repo1", ws as never, makeDaemonInfo());

    expect(connected).toHaveBeenCalledOnce();
    expect(connected.mock.calls[0][0].daemonId).toBe("test/repo1");
  });

  it("sendToDaemon sends to the correct socket", () => {
    const ws = createMockSocket();
    registry.register("test/repo1", ws as never, makeDaemonInfo());

    const message: HqToDaemonMessage = {
      type: "request-status",
      timestamp: Date.now(),
      payload: { projectId: "proj-1" },
    };

    expect(registry.sendToDaemon("test/repo1", message)).toBe(true);
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]).type).toBe("request-status");
  });

  it("sendToDaemon returns false for unknown daemon", () => {
    const message: HqToDaemonMessage = {
      type: "request-status",
      timestamp: Date.now(),
      payload: { projectId: "x" },
    };
    expect(registry.sendToDaemon("ghost", message)).toBe(false);
  });

  it("broadcastToDaemons sends to all connected", () => {
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();
    registry.register("test/repo1", ws1 as never, makeDaemonInfo({ projectId: "p1" }));
    registry.register("d2", ws2 as never, makeDaemonInfo({ projectId: "p2" }));

    const msg: HqToDaemonMessage = {
      type: "request-status",
      timestamp: Date.now(),
      payload: { projectId: "all" },
    };
    registry.broadcastToDaemons(msg);

    expect(ws1.sent).toHaveLength(1);
    expect(ws2.sent).toHaveLength(1);
  });

  it("recordHeartbeat updates last heartbeat time", () => {
    const ws = createMockSocket();
    registry.register("test/repo1", ws as never, makeDaemonInfo());
    const before = registry.getDaemon("test/repo1")!.lastHeartbeat;

    registry.recordHeartbeat("test/repo1");
    const after = registry.getDaemon("test/repo1")!.lastHeartbeat;

    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("checkHeartbeats removes timed-out daemons", () => {
    const ws = createMockSocket();
    registry.register("test/repo1", ws as never, makeDaemonInfo());

    // Manually set lastHeartbeat to the past
    const daemon = registry.getDaemon("test/repo1")!;
    daemon.lastHeartbeat = Date.now() - HEARTBEAT_TIMEOUT_MS - 1000;

    const timedOut = registry.checkHeartbeats();
    expect(timedOut).toContain("test/repo1");
    expect(registry.size).toBe(0);
  });

  it("checkHeartbeats does not remove fresh daemons", () => {
    const ws = createMockSocket();
    registry.register("test/repo1", ws as never, makeDaemonInfo());

    const timedOut = registry.checkHeartbeats();
    expect(timedOut).toHaveLength(0);
    expect(registry.size).toBe(1);
  });

  it("handles re-registration (daemon reconnect)", () => {
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();
    registry.register("test/repo1", ws1 as never, makeDaemonInfo());
    registry.register("test/repo1", ws2 as never, makeDaemonInfo());

    expect(registry.size).toBe(1);
    // New socket should be active
    const daemon = registry.getDaemon("test/repo1")!;
    expect(daemon.ws).toBe(ws2);
  });
});

// --- DaemonWsHandler tests ---

describe("DaemonWsHandler", () => {
  let registry: DaemonRegistry;
  let broadcast: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof createMockLog>;
  const validToken = "a".repeat(64);

  function createHandler(tokenLookup?: TokenLookup) {
    const lookup = tokenLookup ?? ((_id: string) => validToken);
    return new DaemonWsHandler(registry, lookup, broadcast as BrowserBroadcast, log as never);
  }

  beforeEach(() => {
    registry = new DaemonRegistry();
    broadcast = vi.fn();
    log = createMockLog();
  });

  afterEach(() => {
    registry.stopHeartbeatMonitor();
  });

  it("sends auth-challenge on new connection", () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    expect(ws.sent).toHaveLength(1);
    const msg = JSON.parse(ws.sent[0]);
    expect(msg.type).toBe("auth-challenge");
    expect(msg.payload.nonce).toBeDefined();
  });

  it("rejects auth with wrong nonce", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    const challenge = JSON.parse(ws.sent[0]);
    const authResponse: DaemonToHqMessage = {
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: "wrong-nonce" },
    };
    ws.simulateMessage(JSON.stringify(authResponse));
    await tick();

    // Should have challenge + reject
    expect(ws.sent).toHaveLength(2);
    const reject = JSON.parse(ws.sent[1]);
    expect(reject.type).toBe("auth-reject");
    expect(reject.payload.reason).toBe("Nonce mismatch");
    expect(ws.lastCloseCode).toBe(WS_CLOSE_AUTH_REJECTED);
    expect(ws.lastCloseReason).toBe("Nonce mismatch");
  });

  it("rejects auth with invalid token", async () => {
    const handler = createHandler(() => "expected-token");
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    const challenge = JSON.parse(ws.sent[0]);
    const authResponse: DaemonToHqMessage = {
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: "wrong-token", nonce: challenge.payload.nonce },
    };
    ws.simulateMessage(JSON.stringify(authResponse));
    await tick();

    expect(ws.sent).toHaveLength(2);
    const reject = JSON.parse(ws.sent[1]);
    expect(reject.type).toBe("auth-reject");
    expect(reject.payload.reason).toBe("Invalid token");
    expect(ws.lastCloseCode).toBe(WS_CLOSE_AUTH_REJECTED);
    expect(ws.lastCloseReason).toBe("Invalid token");
  });

  it("accepts auth with correct token and nonce", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    const challenge = JSON.parse(ws.sent[0]);
    const authResponse: DaemonToHqMessage = {
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: challenge.payload.nonce },
    };
    ws.simulateMessage(JSON.stringify(authResponse));
    await tick();

    expect(ws.sent).toHaveLength(2);
    const accept = JSON.parse(ws.sent[1]);
    expect(accept.type).toBe("auth-accept");
  });

  it("processes register message after auth", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    // Auth flow
    const challenge = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: challenge.payload.nonce },
    }));
    await tick();

    // Now send register
    ws.simulateMessage(JSON.stringify({
      type: "register",
      timestamp: Date.now(),
      payload: makeDaemonInfo(),
    }));

    expect(registry.size).toBe(1);
    expect(registry.getDaemon("proj-1")).toBeDefined();
  });

  it("ignores non-auth messages before authentication", () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    ws.simulateMessage(JSON.stringify({
      type: "register",
      timestamp: Date.now(),
      payload: makeDaemonInfo(),
    }));

    // Should not register — still in auth phase
    expect(registry.size).toBe(0);
    expect(log.warn).toHaveBeenCalled();
  });

  it("routes heartbeat messages", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    // Complete auth
    const challenge = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: challenge.payload.nonce },
    }));
    await tick();

    // Register
    ws.simulateMessage(JSON.stringify({
      type: "register",
      timestamp: Date.now(),
      payload: makeDaemonInfo(),
    }));

    const beforeHb = registry.getDaemon("proj-1")!.lastHeartbeat;

    // Send heartbeat
    ws.simulateMessage(JSON.stringify({
      type: "heartbeat",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", uptimeMs: 5000 },
    }));

    expect(registry.getDaemon("proj-1")!.lastHeartbeat).toBeGreaterThanOrEqual(beforeHb);
  });

  it("routes status-update to browser clients", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    // Complete auth + register
    const challenge = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: challenge.payload.nonce },
    }));
    await tick();
    ws.simulateMessage(JSON.stringify({
      type: "register",
      timestamp: Date.now(),
      payload: makeDaemonInfo(),
    }));

    // Send status update
    ws.simulateMessage(JSON.stringify({
      type: "status-update",
      timestamp: Date.now(),
      payload: {
        projectId: "proj-1",
        state: { initialized: true, daemonOnline: true, workState: "working" },
      },
    }));

    expect(broadcast).toHaveBeenCalledWith("daemon", expect.objectContaining({
      type: "daemon:status-update",
      daemonId: "proj-1",
    }));
  });

  it("routes terminal-data to browser clients", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    // Auth + register
    const challenge = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: challenge.payload.nonce },
    }));
    await tick();
    ws.simulateMessage(JSON.stringify({
      type: "register",
      timestamp: Date.now(),
      payload: makeDaemonInfo(),
    }));

    // Terminal data
    ws.simulateMessage(JSON.stringify({
      type: "terminal-data",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", sessionId: "s1", data: "hello" },
    }));

    expect(broadcast).toHaveBeenCalledWith("terminal", expect.objectContaining({
      type: "terminal:data",
      projectId: "proj-1",
      sessionId: "s1",
    }));
  });

  it("routes terminal-exit to browser clients", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    // Auth + register
    const challenge = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: challenge.payload.nonce },
    }));
    await tick();
    ws.simulateMessage(JSON.stringify({
      type: "register",
      timestamp: Date.now(),
      payload: makeDaemonInfo(),
    }));

    // Terminal exit
    ws.simulateMessage(JSON.stringify({
      type: "terminal-exit",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", terminalId: "t1", exitCode: 0 },
    }));

    expect(broadcast).toHaveBeenCalledWith("terminal", expect.objectContaining({
      type: "terminal:exit",
      projectId: "proj-1",
      terminalId: "t1",
      exitCode: 0,
    }));
  });

  it("routes copilot-session-list to registry event", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    // Auth + register
    const challenge = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: challenge.payload.nonce },
    }));
    await tick();
    ws.simulateMessage(JSON.stringify({
      type: "register",
      timestamp: Date.now(),
      payload: makeDaemonInfo(),
    }));

    const emitSpy = vi.spyOn(registry, "emit");
    ws.simulateMessage(JSON.stringify({
      type: "copilot-session-list",
      timestamp: Date.now(),
      payload: {
        projectId: "proj-1",
        requestId: "req-1",
        sessions: [{ sessionId: "cs1", startTime: "2025-01-01T00:00:00.000Z", modifiedTime: "2025-01-01T00:00:01.000Z", isRemote: false }],
      },
    }));

    expect(emitSpy).toHaveBeenCalledWith(
      "copilot:session-list",
      expect.anything(),
      expect.objectContaining({ projectId: "proj-1" }),
    );
  });

  it("routes copilot-agent-catalog to registry and browser clients", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    const challenge = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: challenge.payload.nonce },
    }));
    await tick();
    ws.simulateMessage(JSON.stringify({
      type: "register",
      timestamp: Date.now(),
      payload: makeDaemonInfo(),
    }));

    const emitSpy = vi.spyOn(registry, "emit");
    ws.simulateMessage(JSON.stringify({
      type: "copilot-agent-catalog",
      timestamp: Date.now(),
      payload: {
        projectId: "proj-1",
        agents: [
          {
            id: "builtin:default",
            name: "default",
            displayName: "Plain session",
            description: "Standard Copilot session.",
            kind: "default",
            source: "builtin",
          },
          {
            id: "github:squad",
            name: "squad",
            displayName: "Squad",
            description: "Coordinates specialists.",
            kind: "custom",
            source: "github-agent-file",
            path: ".github/agents/squad.agent.md",
          },
        ],
      },
    }));

    expect(emitSpy).toHaveBeenCalledWith(
      "copilot:agent-catalog",
      expect.anything(),
      expect.objectContaining({ projectId: "proj-1" }),
    );
    expect(broadcast).toHaveBeenCalledWith("copilot", expect.objectContaining({
      type: "copilot:agent-catalog",
      projectId: "proj-1",
      agents: expect.arrayContaining([
        expect.objectContaining({ id: "github:squad" }),
      ]),
    }));
  });

  it("handles disconnect and broadcasts to browsers", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    // Auth + register
    const challenge = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: challenge.payload.nonce },
    }));
    await tick();
    ws.simulateMessage(JSON.stringify({
      type: "register",
      timestamp: Date.now(),
      payload: makeDaemonInfo(),
    }));

    expect(registry.size).toBe(1);

    // Simulate disconnect
    ws.simulateClose();

    expect(registry.size).toBe(0);
    expect(broadcast).toHaveBeenCalledWith("daemon", expect.objectContaining({
      type: "daemon:disconnected",
    }));
  });

  it("ignores invalid JSON from daemon", async () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    // Complete auth first
    const challenge = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId: "proj-1", token: validToken, nonce: challenge.payload.nonce },
    }));
    await tick();

    // Send garbage
    ws.simulateMessage("not valid json{{{");
    expect(log.warn).toHaveBeenCalled();
  });

  it("cleanup closes pending connections", () => {
    const handler = createHandler();
    const ws = createMockSocket();
    handler.handleConnection(ws as never);

    handler.cleanup();
    // Should not throw
  });
});

// --- REST endpoint tests ---

describe("Daemon REST routes", () => {
  let server: FastifyInstance;
  let registry: DaemonRegistry;
  let stateService: ReturnType<typeof createMockStateService>;

  beforeEach(async () => {
    server = await createTestServer();
    registry = new DaemonRegistry();
    stateService = createMockStateService();
    server.decorate("daemonRegistry", registry);
    server.decorate("stateService", stateService as never);
    await server.register(daemonRoutes);
  });

  afterEach(async () => {
    registry.stopHeartbeatMonitor();
    await server.close();
  });

  it("GET /api/daemons returns empty list", async () => {
    const res = await server.inject({ method: "GET", url: "/api/daemons" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("GET /api/daemons returns registered daemons", async () => {
    const ws = createMockSocket();
    registry.register("test/repo1", ws as never, makeDaemonInfo({ projectName: "Alpha" }));

    const res = await server.inject({ method: "GET", url: "/api/daemons" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].projectName).toBe("Alpha");
  });

  it("GET /api/daemons/:id returns daemon detail", async () => {
    const ws = createMockSocket();
    registry.register("test/repo1", ws as never, makeDaemonInfo({ projectName: "Beta" }));

    const res = await server.inject({ method: "GET", url: "/api/daemons/test/repo1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projectName).toBe("Beta");
    expect(body.protocolVersion).toBe("1.0.0");
  });

  it("GET /api/daemons/:id/copilot/agents returns catalog with remembered preference", async () => {
    const ws = createMockSocket();
    const info: DaemonInfo & {
      copilotSdkAgents: Array<{
        id: string;
        name: string;
        displayName: string;
        description: string;
        userInvocable: boolean;
      }>;
    } = {
      ...makeDaemonInfo({ projectId: "test/repo1" }),
      copilotSdkAgents: [
        {
          id: "github:reviewer",
          name: "reviewer",
          displayName: "Reviewer",
          description: "Reviews changes",
          userInvocable: true,
        },
        {
          id: "github:planner",
          name: "planner",
          displayName: "Planner",
          description: "Plans work",
          userInvocable: true,
        },
      ],
    };
    registry.register("test/repo1", ws as never, info);
    stateService.getProjectDefaultCopilotAgent.mockResolvedValue("github:reviewer");

    const res = await server.inject({ method: "GET", url: "/api/daemons/test/repo1/copilot/agents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      projectId: "test/repo1",
      daemonOnline: true,
      preferredAgent: "github:reviewer",
      agents: [
        {
          id: "github:reviewer",
          name: "reviewer",
          displayName: "Reviewer",
          description: "Reviews changes",
          kind: "custom",
          source: "github-agent-file",
          userInvocable: true,
        },
        {
          id: "github:planner",
          name: "planner",
          displayName: "Planner",
          description: "Plans work",
          kind: "custom",
          source: "github-agent-file",
          userInvocable: true,
        },
      ],
    });
  });

  it("PUT /api/daemons/:id/copilot/agents updates the remembered preference", async () => {
    const ws = createMockSocket();
    const info: DaemonInfo & { copilotAgents: string[] } = {
      ...makeDaemonInfo({ projectId: "test/repo1" }),
      copilotAgents: ["reviewer", "planner"],
    };
    registry.register("test/repo1", ws as never, info);

    const res = await server.inject({
      method: "PUT",
      url: "/api/daemons/test/repo1/copilot/agents",
      payload: { preferredAgent: "planner" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      projectId: "test/repo1",
      daemonOnline: true,
      preferredAgent: "planner",
      agents: [
        {
          id: "reviewer",
          name: "reviewer",
          displayName: "reviewer",
          description: "",
          kind: "custom",
          source: "github-agent-file",
        },
        {
          id: "planner",
          name: "planner",
          displayName: "planner",
          description: "",
          kind: "custom",
          source: "github-agent-file",
        },
      ],
    });
  });

  it("GET /api/daemons/:id returns 404 for unknown", async () => {
    const res = await server.inject({ method: "GET", url: "/api/daemons/test/ghost" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });

  it("POST /api/daemons/:id/command sends to daemon", async () => {
    const ws = createMockSocket();
    registry.register("test/repo1", ws as never, makeDaemonInfo());

    const res = await server.inject({
      method: "POST",
      url: "/api/daemons/test/repo1/command",
      payload: { action: "restart" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]).type).toBe("command");
  });

  it("POST /api/daemons/:id/command returns 404 for unknown daemon", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/daemons/test/ghost/command",
      payload: { action: "restart" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/daemons/:id/command returns 400 for missing action", async () => {
    const ws = createMockSocket();
    registry.register("test/repo1", ws as never, makeDaemonInfo());

    const res = await server.inject({
      method: "POST",
      url: "/api/daemons/test/repo1/command",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/daemons/:id/command returns 502 when daemon is disconnected", async () => {
    const ws = createMockSocket();
    ws.readyState = 3; // CLOSED
    registry.register("test/repo1", ws as never, makeDaemonInfo());

    const res = await server.inject({
      method: "POST",
      url: "/api/daemons/test/repo1/command",
      payload: { action: "stop" },
    });
    expect(res.statusCode).toBe(502);
  });
});
