import { describe, it, expect, vi, afterEach } from "vitest";
import { createTestServer, type FastifyInstance } from "../../../test-utils/server.js";
import websocket from "../../ws/plugin.js";
import selfDaemonRoutes from "../../routes/self-daemon.js";

// Mock the spawner so we never actually fork a process
vi.mock("../spawner.js", () => {
  class MockSelfDaemonSpawner {
    config: unknown;
    start = vi.fn();
    stop = vi.fn();
    isRunning = vi.fn();
    getPid = vi.fn();
    getStatus = vi.fn();
    private _running = false;

    constructor(options: { config: { projectId: string; enabled: boolean } }) {
      this.config = options.config;
      const self = this;
      this.start.mockImplementation(async () => {
        self._running = true;
      });
      this.stop.mockImplementation(async () => {
        self._running = false;
      });
      this.isRunning.mockImplementation(() => self._running);
      this.getPid.mockImplementation(() => (self._running ? 99999 : null));
      this.getStatus.mockImplementation(() => ({
        running: self._running,
        pid: self._running ? 99999 : null,
        projectId: options.config.projectId,
        enabled: options.config.enabled,
        restartCount: 0,
      }));
    }
  }

  return {
    SelfDaemonSpawner: MockSelfDaemonSpawner,
    detectProjectId: vi.fn().mockReturnValue("test-owner/test-repo"),
    parseGitRemoteUrl: vi.fn().mockReturnValue("test-owner/test-repo"),
  };
});

// Mock child_process to avoid importing the real thing
vi.mock("node:child_process", () => ({
  fork: vi.fn(),
  execSync: vi.fn(),
}));

import terminalRelayPlugin from "../../terminal-relay/plugin.js";
import daemonRegistryPlugin from "../../daemon-registry/plugin.js";
import selfDaemonPlugin from "../plugin.js";

describe("Self-daemon routes", () => {
  let server: FastifyInstance;

  async function buildServer(): Promise<FastifyInstance> {
    server = await createTestServer();
    await server.register(websocket);
    await server.register(terminalRelayPlugin);
    await server.register(daemonRegistryPlugin);
    await server.register(selfDaemonPlugin, { enabled: false });
    await server.register(selfDaemonRoutes);
    return server;
  }

  afterEach(async () => {
    if (server) await server.close();
  });

  // ── GET /api/self-daemon ─────────────────────────────

  it("GET /api/self-daemon returns status", async () => {
    await buildServer();

    const res = await server.inject({
      method: "GET",
      url: "/api/self-daemon",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("running");
    expect(body).toHaveProperty("pid");
    expect(body).toHaveProperty("projectId");
    expect(body).toHaveProperty("enabled");
    expect(body).toHaveProperty("restartCount");
  });

  // ── POST /api/self-daemon/start ──────────────────────

  it("POST /api/self-daemon/start starts the daemon", async () => {
    await buildServer();

    const res = await server.inject({
      method: "POST",
      url: "/api/self-daemon/start",
    });

    expect(res.statusCode).toBe(200);
    expect(server.selfDaemon.start).toHaveBeenCalled();
  });

  it("POST /api/self-daemon/start returns 409 if already running", async () => {
    await buildServer();

    // Start once
    await server.inject({ method: "POST", url: "/api/self-daemon/start" });

    // Start again
    const res = await server.inject({
      method: "POST",
      url: "/api/self-daemon/start",
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toHaveProperty("error", "already_running");
  });

  // ── POST /api/self-daemon/stop ───────────────────────

  it("POST /api/self-daemon/stop returns 409 if not running", async () => {
    await buildServer();

    const res = await server.inject({
      method: "POST",
      url: "/api/self-daemon/stop",
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toHaveProperty("error", "not_running");
  });

  it("POST /api/self-daemon/stop stops a running daemon", async () => {
    await buildServer();

    // Start first
    await server.inject({ method: "POST", url: "/api/self-daemon/start" });

    const res = await server.inject({
      method: "POST",
      url: "/api/self-daemon/stop",
    });

    expect(res.statusCode).toBe(200);
    expect(server.selfDaemon.stop).toHaveBeenCalled();
  });

  // ── POST /api/self-daemon/restart ────────────────────

  it("POST /api/self-daemon/restart restarts the daemon", async () => {
    await buildServer();

    // Start first
    await server.inject({ method: "POST", url: "/api/self-daemon/start" });

    const res = await server.inject({
      method: "POST",
      url: "/api/self-daemon/restart",
    });

    expect(res.statusCode).toBe(200);
    expect(server.selfDaemon.stop).toHaveBeenCalled();
    expect(server.selfDaemon.start).toHaveBeenCalled();
  });

  it("POST /api/self-daemon/restart works from stopped state", async () => {
    await buildServer();

    const res = await server.inject({
      method: "POST",
      url: "/api/self-daemon/restart",
    });

    expect(res.statusCode).toBe(200);
    expect(server.selfDaemon.start).toHaveBeenCalled();
  });
});
