import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DockerExecutor } from "../discovery.js";
import { discoverContainers, isDockerAvailable } from "../discovery.js";
import { ContainerMonitor, type BroadcastFn } from "../monitor.js";
import type { ContainerStatusUpdate, DevContainer, DiscoveryResult } from "../types.js";

// --- Mock executor factory ---

function createMockExecutor(responses: Record<string, { stdout: string; stderr: string }>): DockerExecutor {
  return {
    async exec(_command: string, args: string[]) {
      const key = args[0]; // "info", "ps", "inspect"
      const response = responses[key];
      if (!response) throw new Error(`Mock: no response for '${key}'`);
      return response;
    },
  };
}

function createFailingExecutor(): DockerExecutor {
  return {
    async exec() {
      throw new Error("Docker not found");
    },
  };
}

// Sample Docker inspect output
const sampleInspect = JSON.stringify([
  {
    Id: "abc123def456789",
    Name: "/my-devcontainer",
    State: { Status: "running", StartedAt: "2026-03-13T10:00:00Z" },
    Config: {
      Image: "mcr.microsoft.com/devcontainers/typescript-node:20",
      Labels: {
        "devcontainer.local_folder": "/home/user/projects/myorg/myrepo",
      },
    },
    Created: "2026-03-13T09:55:00Z",
    HostConfig: { PortBindings: {} },
    NetworkSettings: {
      Ports: {
        "3000/tcp": [{ HostPort: "3000" }],
        "5173/tcp": [{ HostPort: "5173" }],
        "8080/tcp": null,
      },
    },
  },
]);

// --- isDockerAvailable ---

describe("isDockerAvailable", () => {
  it("returns true when docker info succeeds", async () => {
    const executor = createMockExecutor({
      info: { stdout: "abc123\n", stderr: "" },
    });
    expect(await isDockerAvailable(executor)).toBe(true);
  });

  it("returns false when docker is not installed", async () => {
    expect(await isDockerAvailable(createFailingExecutor())).toBe(false);
  });
});

// --- discoverContainers ---

describe("discoverContainers", () => {
  it("returns containers when Docker is available and devcontainers exist", async () => {
    const executor = createMockExecutor({
      info: { stdout: "abc123\n", stderr: "" },
      ps: { stdout: "abc123def456\n", stderr: "" },
      inspect: { stdout: sampleInspect, stderr: "" },
    });

    const result = await discoverContainers(executor);

    expect(result.dockerAvailable).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.containers).toHaveLength(1);

    const c = result.containers[0];
    expect(c.containerId).toBe("abc123def456");
    expect(c.name).toBe("my-devcontainer");
    expect(c.status).toBe("running");
    expect(c.workspaceFolder).toBe("/home/user/projects/myorg/myrepo");
    expect(c.repository).toBe("myorg/myrepo");
    expect(c.image).toBe("mcr.microsoft.com/devcontainers/typescript-node:20");
    expect(c.ports).toContain("3000:3000/tcp");
    expect(c.ports).toContain("5173:5173/tcp");
    expect(c.ports).toHaveLength(2);
  });

  it("returns empty containers when no devcontainers found", async () => {
    const executor = createMockExecutor({
      info: { stdout: "abc123\n", stderr: "" },
      ps: { stdout: "\n", stderr: "" },
    });

    const result = await discoverContainers(executor);

    expect(result.dockerAvailable).toBe(true);
    expect(result.containers).toHaveLength(0);
    expect(result.error).toBeUndefined();
  });

  it("returns dockerAvailable=false when Docker is unreachable", async () => {
    const result = await discoverContainers(createFailingExecutor());

    expect(result.dockerAvailable).toBe(false);
    expect(result.containers).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it("handles inspect failure gracefully", async () => {
    const executor: DockerExecutor = {
      async exec(_cmd, args) {
        if (args[0] === "info") return { stdout: "ok\n", stderr: "" };
        if (args[0] === "ps") return { stdout: "abc123\n", stderr: "" };
        throw new Error("inspect failed");
      },
    };

    const result = await discoverContainers(executor);

    expect(result.dockerAvailable).toBe(true);
    expect(result.containers).toHaveLength(0);
    expect(result.error).toContain("inspect failed");
  });

  it("handles stopped containers", async () => {
    const stoppedInspect = JSON.stringify([{
      Id: "stopped123456789",
      Name: "/stopped-dev",
      State: { Status: "exited" },
      Config: {
        Image: "node:20",
        Labels: { "devcontainer.local_folder": "/workspace" },
      },
      Created: "2026-03-13T09:00:00Z",
      NetworkSettings: { Ports: {} },
    }]);

    const executor = createMockExecutor({
      info: { stdout: "ok\n", stderr: "" },
      ps: { stdout: "stopped12345\n", stderr: "" },
      inspect: { stdout: stoppedInspect, stderr: "" },
    });

    const result = await discoverContainers(executor);
    expect(result.containers[0].status).toBe("stopped");
  });
});

// --- ContainerMonitor ---

function createMockLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("ContainerMonitor", () => {
  let broadcastFn: ReturnType<typeof vi.fn<BroadcastFn>>;
  let log: ReturnType<typeof createMockLog>;

  beforeEach(() => {
    broadcastFn = vi.fn<BroadcastFn>();
    log = createMockLog();
  });

  it("starts and stops cleanly", () => {
    const executor = createMockExecutor({
      info: { stdout: "ok\n", stderr: "" },
      ps: { stdout: "\n", stderr: "" },
    });

    const monitor = new ContainerMonitor({
      broadcast: broadcastFn,
      log,
      config: { pollIntervalMs: 60_000, enabled: true },
      executor,
    });

    monitor.start();
    monitor.stop();

    // Verify log messages
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("started"));
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("stopped"));
  });

  it("does not start when disabled", () => {
    const monitor = new ContainerMonitor({
      broadcast: broadcastFn,
      log,
      config: { pollIntervalMs: 60_000, enabled: false },
    });

    monitor.start();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    monitor.stop();
  });

  it("detects new containers on first poll", async () => {
    const executor = createMockExecutor({
      info: { stdout: "ok\n", stderr: "" },
      ps: { stdout: "abc123def456\n", stderr: "" },
      inspect: { stdout: sampleInspect, stderr: "" },
    });

    const monitor = new ContainerMonitor({
      broadcast: broadcastFn,
      log,
      executor,
      config: { pollIntervalMs: 60_000, enabled: true },
    });

    await monitor.poll();

    expect(broadcastFn).toHaveBeenCalledTimes(1);
    const payload = broadcastFn.mock.calls[0][1] as ContainerStatusUpdate;
    expect(payload.type).toBe("container_status_update");
    expect(payload.containers).toHaveLength(1);
    expect(payload.changes).toHaveLength(1);
    expect(payload.changes[0].previousStatus).toBe("absent");
    expect(payload.changes[0].currentStatus).toBe("running");
  });

  it("detects container removal", async () => {
    // First poll: container present
    const executor1 = createMockExecutor({
      info: { stdout: "ok\n", stderr: "" },
      ps: { stdout: "abc123def456\n", stderr: "" },
      inspect: { stdout: sampleInspect, stderr: "" },
    });

    const monitor = new ContainerMonitor({
      broadcast: broadcastFn,
      log,
      executor: executor1,
      config: { pollIntervalMs: 60_000, enabled: true },
    });

    await monitor.poll();
    broadcastFn.mockClear();

    // Second poll: no containers. Replace the executor's behavior.
    // We need a fresh executor that returns empty ps
    const emptyExecutor = createMockExecutor({
      info: { stdout: "ok\n", stderr: "" },
      ps: { stdout: "\n", stderr: "" },
    });

    // Access internal executor via a new monitor that shares state
    // Instead, we'll create a monitor with a programmable executor
    const calls: number[] = [0];
    const switchableExecutor: DockerExecutor = {
      async exec(cmd, args) {
        if (calls[0] === 0) {
          return executor1.exec(cmd, args);
        }
        return emptyExecutor.exec(cmd, args);
      },
    };

    const monitor2 = new ContainerMonitor({
      broadcast: broadcastFn,
      log,
      executor: switchableExecutor,
      config: { pollIntervalMs: 60_000, enabled: true },
    });

    // First poll — container appears
    await monitor2.poll();
    broadcastFn.mockClear();

    // Second poll — container gone
    calls[0] = 1;
    await monitor2.poll();

    expect(broadcastFn).toHaveBeenCalledTimes(1);
    const payload = broadcastFn.mock.calls[0][1] as ContainerStatusUpdate;
    expect(payload.changes).toHaveLength(1);
    expect(payload.changes[0].currentStatus).toBe("absent");
  });

  it("does not broadcast when nothing changes", async () => {
    const executor = createMockExecutor({
      info: { stdout: "ok\n", stderr: "" },
      ps: { stdout: "abc123def456\n", stderr: "" },
      inspect: { stdout: sampleInspect, stderr: "" },
    });

    const monitor = new ContainerMonitor({
      broadcast: broadcastFn,
      log,
      executor,
      config: { pollIntervalMs: 60_000, enabled: true },
    });

    await monitor.poll();
    broadcastFn.mockClear();

    // Same state — no changes
    await monitor.poll();
    expect(broadcastFn).not.toHaveBeenCalled();
  });

  it("detects status change from running to stopped", async () => {
    const runningInspect = JSON.stringify([{
      Id: "abc123def456789",
      Name: "/my-devcontainer",
      State: { Status: "running" },
      Config: { Image: "node:20", Labels: { "devcontainer.local_folder": "/workspace" } },
      Created: "2026-03-13T09:55:00Z",
      NetworkSettings: { Ports: {} },
    }]);

    const stoppedInspect = JSON.stringify([{
      Id: "abc123def456789",
      Name: "/my-devcontainer",
      State: { Status: "exited" },
      Config: { Image: "node:20", Labels: { "devcontainer.local_folder": "/workspace" } },
      Created: "2026-03-13T09:55:00Z",
      NetworkSettings: { Ports: {} },
    }]);

    let pollCount = 0;
    const executor: DockerExecutor = {
      async exec(_cmd, args) {
        if (args[0] === "info") return { stdout: "ok\n", stderr: "" };
        if (args[0] === "ps") return { stdout: "abc123def456\n", stderr: "" };
        if (args[0] === "inspect") {
          return { stdout: pollCount === 0 ? runningInspect : stoppedInspect, stderr: "" };
        }
        throw new Error(`Unexpected: ${args[0]}`);
      },
    };

    const monitor = new ContainerMonitor({
      broadcast: broadcastFn,
      log,
      executor,
      config: { pollIntervalMs: 60_000, enabled: true },
    });

    // Poll 1: running
    await monitor.poll();
    broadcastFn.mockClear();
    pollCount = 1;

    // Poll 2: stopped
    await monitor.poll();
    expect(broadcastFn).toHaveBeenCalledTimes(1);
    const payload = broadcastFn.mock.calls[0][1] as ContainerStatusUpdate;
    expect(payload.changes[0].previousStatus).toBe("running");
    expect(payload.changes[0].currentStatus).toBe("stopped");
  });

  it("stores lastResult after poll", async () => {
    const executor = createMockExecutor({
      info: { stdout: "ok\n", stderr: "" },
      ps: { stdout: "\n", stderr: "" },
    });

    const monitor = new ContainerMonitor({
      broadcast: broadcastFn,
      log,
      executor,
      config: { pollIntervalMs: 60_000, enabled: true },
    });

    expect(monitor.lastResult).toBeNull();
    await monitor.poll();
    expect(monitor.lastResult).not.toBeNull();
    expect(monitor.lastResult!.dockerAvailable).toBe(true);
  });

  it("handles Docker becoming unavailable mid-monitoring", async () => {
    let dockerUp = true;
    const executor: DockerExecutor = {
      async exec(_cmd, args) {
        if (!dockerUp) throw new Error("Docker gone");
        if (args[0] === "info") return { stdout: "ok\n", stderr: "" };
        if (args[0] === "ps") return { stdout: "abc123def456\n", stderr: "" };
        if (args[0] === "inspect") return { stdout: sampleInspect, stderr: "" };
        throw new Error(`Unexpected: ${args[0]}`);
      },
    };

    const monitor = new ContainerMonitor({
      broadcast: broadcastFn,
      log,
      executor,
      config: { pollIntervalMs: 60_000, enabled: true },
    });

    // Docker is up
    await monitor.poll();
    broadcastFn.mockClear();

    // Docker goes down
    dockerUp = false;
    await monitor.poll();

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("unavailable"));
  });
});

// --- Type sanity checks ---

describe("types", () => {
  it("DevContainer has all required fields", () => {
    const c: DevContainer = {
      containerId: "abc123",
      name: "test",
      status: "running",
      workspaceFolder: "/workspace",
      ports: ["3000:3000/tcp"],
      image: "node:20",
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(c.containerId).toBeDefined();
    expect(c.repository).toBeUndefined(); // optional
  });

  it("DiscoveryResult captures scan metadata", () => {
    const r: DiscoveryResult = {
      containers: [],
      scannedAt: new Date().toISOString(),
      dockerAvailable: true,
    };
    expect(r.error).toBeUndefined();
  });
});
