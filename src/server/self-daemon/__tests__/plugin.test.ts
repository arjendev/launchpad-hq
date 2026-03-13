import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestServer, type FastifyInstance } from "../../../test-utils/server.js";
import websocket from "../../ws/plugin.js";

// Mock the spawner so we never actually fork a process
vi.mock("../spawner.js", () => {
  class MockSelfDaemonSpawner {
    config: unknown;
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    isRunning = vi.fn().mockReturnValue(false);
    getPid = vi.fn().mockReturnValue(null);
    getStatus = vi.fn();

    constructor(options: { config: { projectId: string; enabled: boolean } }) {
      this.config = options.config;
      this.getStatus.mockReturnValue({
        running: false,
        pid: null,
        projectId: options.config.projectId,
        enabled: options.config.enabled,
        restartCount: 0,
      });
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

import daemonRegistryPlugin from "../../daemon-registry/plugin.js";
import selfDaemonPlugin from "../plugin.js";

describe("Self-daemon plugin", () => {
  let server: FastifyInstance;

  async function buildServer(
    options: { enabled?: boolean } = {},
  ): Promise<FastifyInstance> {
    server = await createTestServer();
    await server.register(websocket);
    await server.register(daemonRegistryPlugin);
    await server.register(selfDaemonPlugin, { enabled: options.enabled });
    return server;
  }

  afterEach(async () => {
    if (server) await server.close();
  });

  it("decorates fastify with selfDaemon", async () => {
    await buildServer();
    await server.ready();

    expect(server.selfDaemon).toBeDefined();
    expect(typeof server.selfDaemon.start).toBe("function");
    expect(typeof server.selfDaemon.stop).toBe("function");
    expect(typeof server.selfDaemon.isRunning).toBe("function");
    expect(typeof server.selfDaemon.getStatus).toBe("function");
  });

  it("starts daemon on server ready", async () => {
    await buildServer({ enabled: true });
    await server.listen({ port: 0 });

    expect(server.selfDaemon.start).toHaveBeenCalledOnce();
  });

  it("stops daemon on server close", async () => {
    await buildServer({ enabled: true });
    await server.listen({ port: 0 });
    await server.close();

    expect(server.selfDaemon.stop).toHaveBeenCalledOnce();
  });

  it("does not start daemon when disabled", async () => {
    await buildServer({ enabled: false });
    await server.listen({ port: 0 });

    expect(server.selfDaemon.start).not.toHaveBeenCalled();
  });
});
