import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

// ── Mock child_process.fork ──────────────────────────────

function createMockChildProcess(): ChildProcess {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  return Object.assign(emitter, {
    pid: 12345,
    stdout,
    stderr,
    stdin: null,
    stdio: [null, stdout, stderr, null, null] as ChildProcess["stdio"],
    connected: true,
    exitCode: null,
    signalCode: null,
    killed: false,
    spawnargs: [],
    spawnfile: "",
    channel: undefined,
    send: vi.fn(),
    disconnect: vi.fn(),
    unref: vi.fn(),
    ref: vi.fn(),
    [Symbol.dispose]: vi.fn(),
    kill: vi.fn(function (this: ChildProcess & EventEmitter, _signal?: string) {
      // Simulate async exit after kill
      setTimeout(() => {
        (this as EventEmitter).emit("exit", 0, _signal ?? "SIGTERM");
      }, 10);
      return true;
    }),
  }) as unknown as ChildProcess;
}

let mockChild: ChildProcess;

vi.mock("node:child_process", () => ({
  fork: vi.fn(() => mockChild),
  execSync: vi.fn(() => "https://github.com/test-owner/test-repo.git\n"),
}));

import { SelfDaemonSpawner, detectProjectId, parseGitRemoteUrl } from "../spawner.js";
import { fork, execSync } from "node:child_process";

const mockFork = vi.mocked(fork);
const mockExecSync = vi.mocked(execSync);

describe("SelfDaemonSpawner", () => {
  const baseConfig = {
    hqUrl: "ws://localhost:3000",
    token: "test-token-abc123",
    projectId: "owner/repo",
    enabled: true,
  };

  beforeEach(() => {
    mockChild = createMockChildProcess();
    mockFork.mockClear();
    mockFork.mockReturnValue(mockChild);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Lifecycle ────────────────────────────────────────

  it("starts and reports running", async () => {
    const spawner = new SelfDaemonSpawner({ config: baseConfig });
    await spawner.start();

    expect(spawner.isRunning()).toBe(true);
    expect(spawner.getPid()).toBe(12345);
    expect(mockFork).toHaveBeenCalledOnce();
  });

  it("does not start twice", async () => {
    const spawner = new SelfDaemonSpawner({ config: baseConfig });
    await spawner.start();
    await spawner.start();

    expect(mockFork).toHaveBeenCalledOnce();
  });

  it("does not start when disabled", async () => {
    const spawner = new SelfDaemonSpawner({
      config: { ...baseConfig, enabled: false },
    });
    await spawner.start();

    expect(spawner.isRunning()).toBe(false);
    expect(mockFork).not.toHaveBeenCalled();
  });

  it("stops with SIGTERM", async () => {
    const spawner = new SelfDaemonSpawner({ config: baseConfig });
    await spawner.start();

    const stopPromise = spawner.stop();
    await vi.advanceTimersByTimeAsync(50);
    await stopPromise;

    expect(spawner.isRunning()).toBe(false);
    expect(spawner.getPid()).toBeNull();
    expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("stop is safe when not running", async () => {
    const spawner = new SelfDaemonSpawner({ config: baseConfig });
    await spawner.stop();

    expect(spawner.isRunning()).toBe(false);
  });

  // ── Environment variables ────────────────────────────

  it("passes config via environment variables", async () => {
    const spawner = new SelfDaemonSpawner({ config: baseConfig });
    await spawner.start();

    const callArgs = mockFork.mock.calls[0];
    const env = callArgs[2]?.env;

    expect(env).toMatchObject({
      LAUNCHPAD_HQ_URL: "ws://localhost:3000",
      LAUNCHPAD_DAEMON_TOKEN: "test-token-abc123",
      LAUNCHPAD_PROJECT_ID: "owner/repo",
      LAUNCHPAD_COPILOT_MOCK: "true",
    });
  });

  // ── Auto-restart ─────────────────────────────────────

  it("auto-restarts on unexpected exit", async () => {
    const spawner = new SelfDaemonSpawner({
      config: baseConfig,
      autoRestart: true,
      maxRestarts: 3,
      restartDelayMs: 100,
    });
    await spawner.start();
    expect(mockFork).toHaveBeenCalledTimes(1);

    // Simulate unexpected exit
    (mockChild as unknown as EventEmitter).emit("exit", 1, null);
    expect(spawner.isRunning()).toBe(false);

    // Advance past restart delay
    mockChild = createMockChildProcess();
    mockFork.mockReturnValue(mockChild);
    await vi.advanceTimersByTimeAsync(100);

    expect(mockFork).toHaveBeenCalledTimes(2);
    expect(spawner.isRunning()).toBe(true);
  });

  it("stops auto-restarting after max attempts", async () => {
    const spawner = new SelfDaemonSpawner({
      config: baseConfig,
      autoRestart: true,
      maxRestarts: 2,
      restartDelayMs: 100,
    });
    await spawner.start();

    // Exhaust restart attempts
    for (let i = 0; i < 2; i++) {
      (mockChild as unknown as EventEmitter).emit("exit", 1, null);
      mockChild = createMockChildProcess();
      mockFork.mockReturnValue(mockChild);
      await vi.advanceTimersByTimeAsync(100 * Math.pow(2, i));
    }

    expect(mockFork).toHaveBeenCalledTimes(3); // 1 initial + 2 restarts

    // One more exit — should NOT restart
    (mockChild as unknown as EventEmitter).emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockFork).toHaveBeenCalledTimes(3);
  });

  it("does not auto-restart on graceful stop", async () => {
    const spawner = new SelfDaemonSpawner({
      config: baseConfig,
      autoRestart: true,
      restartDelayMs: 100,
    });
    await spawner.start();

    const stopPromise = spawner.stop();
    await vi.advanceTimersByTimeAsync(50);
    await stopPromise;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockFork).toHaveBeenCalledOnce();
  });

  // ── Status ───────────────────────────────────────────

  it("getStatus returns correct shape", async () => {
    const spawner = new SelfDaemonSpawner({ config: baseConfig });
    await spawner.start();

    const status = spawner.getStatus();
    expect(status).toEqual({
      running: true,
      pid: 12345,
      projectId: "owner/repo",
      enabled: true,
      restartCount: 0,
    });
  });

  // ── Child process error handling ─────────────────────

  it("handles child process errors", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const spawner = new SelfDaemonSpawner({
      config: baseConfig,
      logger: logger as never,
      autoRestart: false,
    });
    await spawner.start();

    (mockChild as unknown as EventEmitter).emit("error", new Error("boom"));
    expect(logger.error).toHaveBeenCalled();
  });
});

// ── detectProjectId ──────────────────────────────────────

describe("detectProjectId", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses HTTPS remote URL", () => {
    mockExecSync.mockReturnValue(
      "https://github.com/arjendev/launchpad-hq.git\n" as never,
    );
    expect(detectProjectId()).toBe("arjendev/launchpad-hq");
  });

  it("falls back to cwd basename on git failure", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    const result = detectProjectId();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── parseGitRemoteUrl ────────────────────────────────────

describe("parseGitRemoteUrl", () => {
  it("parses HTTPS URL", () => {
    expect(parseGitRemoteUrl("https://github.com/owner/repo.git")).toBe(
      "owner/repo",
    );
  });

  it("parses HTTPS URL without .git suffix", () => {
    expect(parseGitRemoteUrl("https://github.com/owner/repo")).toBe(
      "owner/repo",
    );
  });

  it("parses SSH URL", () => {
    expect(parseGitRemoteUrl("git@github.com:owner/repo.git")).toBe(
      "owner/repo",
    );
  });

  it("parses SSH URL without .git suffix", () => {
    expect(parseGitRemoteUrl("git@github.com:owner/repo")).toBe("owner/repo");
  });
});
