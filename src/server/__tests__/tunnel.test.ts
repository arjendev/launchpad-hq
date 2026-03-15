import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TunnelManager,
  TunnelError,
  tunnelErrorGuidance,
  resetTunnelManager,
  type TunnelState,
} from "../tunnel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_DEVTUNNEL = resolve(__dirname, "fixtures/fake-devtunnel.sh");

describe("TunnelManager", () => {
  let manager: TunnelManager;

  beforeEach(() => {
    resetTunnelManager();
  });

  afterEach(async () => {
    if (manager && manager.getStatus() !== "stopped") {
      await manager.stop().catch(() => {});
    }
  });

  describe("default error listener", () => {
    it("does not throw on unhandled error events", () => {
      manager = new TunnelManager();
      expect(() => {
        manager.emit(
          "error",
          new TunnelError("test error", "PROCESS_ERROR"),
        );
      }).not.toThrow();
    });

    it("logs errors via logger.warn when logger is provided", () => {
      const warnings: string[] = [];
      const mockLogger = {
        warn: (_obj: unknown, msg?: string) => {
          warnings.push(msg ?? String(_obj));
        },
        info: () => {},
        error: () => {},
        debug: () => {},
        fatal: () => {},
        trace: () => {},
        child: () => mockLogger,
      };

      manager = new TunnelManager({
        logger: mockLogger as never,
      });

      manager.emit(
        "error",
        new TunnelError("auth expired", "AUTH_EXPIRED"),
      );

      expect(warnings.some((w) => w.includes("auth expired"))).toBe(true);
    });
  });

  describe("error state tracking", () => {
    it("transitions to error status and records lastError", () => {
      manager = new TunnelManager();
      const states: string[] = [];
      manager.on("status-change", (state) => {
        states.push(state.status);
      });

      manager.emit(
        "error",
        new TunnelError("boom", "PROCESS_ERROR"),
      );

      const state = manager.getState();
      expect(state.status).toBe("stopped");
    });

    it("getState returns error info after a failed start", async () => {
      manager = new TunnelManager({ cliBinary: "nonexistent-binary-xyz" });

      try {
        await manager.start(9999);
      } catch {
        // expected
      }

      const state = manager.getState();
      expect(state.status).toBe("error");
      expect(state.error).toBeTruthy();
      expect(state.error).toContain("not found");
    });
  });

  describe("isCliAvailable", () => {
    it("returns false for a non-existent binary", async () => {
      manager = new TunnelManager({
        cliBinary: "nonexistent-binary-xyz",
      });
      const available = await manager.isCliAvailable();
      expect(available).toBe(false);
    });
  });

  describe("start() error handling", () => {
    it("throws CLI_NOT_FOUND for missing binary", async () => {
      manager = new TunnelManager({
        cliBinary: "nonexistent-binary-xyz",
      });

      await expect(manager.start(9999)).rejects.toThrow(TunnelError);
      await expect(manager.start(9999)).rejects.toMatchObject({
        code: "CLI_NOT_FOUND",
      });
    });
  });

  // ── Idempotency tests ──────────────────────────────────

  describe("start() idempotency", () => {
    it("returns existing info when already running", async () => {
      manager = new TunnelManager({ cliBinary: FAKE_DEVTUNNEL, startupTimeoutMs: 5_000 });
      const info1 = await manager.start(4000);
      const info2 = await manager.start(4000);
      expect(info2).toBe(info1);
      expect(manager.getStatus()).toBe("running");
    });

    it("returns the same promise when called concurrently during startup", async () => {
      manager = new TunnelManager({ cliBinary: FAKE_DEVTUNNEL, startupTimeoutMs: 5_000 });
      const p1 = manager.start(4001);
      const p2 = manager.start(4001);
      const [info1, info2] = await Promise.all([p1, p2]);
      expect(info1).toEqual(info2);
      expect(manager.getStatus()).toBe("running");
    });
  });

  describe("stop() idempotency", () => {
    it("is a no-op when already stopped (no event emitted)", async () => {
      manager = new TunnelManager();
      const events: TunnelState[] = [];
      manager.on("status-change", (s: TunnelState) => events.push(s));

      expect(manager.getStatus()).toBe("stopped");
      await manager.stop();
      expect(manager.getStatus()).toBe("stopped");
      expect(events).toHaveLength(0);
    });

    it("transitions from error to stopped when called", async () => {
      manager = new TunnelManager({ cliBinary: "nonexistent-binary-xyz" });
      try { await manager.start(9999); } catch { /* expected */ }

      expect(manager.getStatus()).toBe("error");
      const events: TunnelState[] = [];
      manager.on("status-change", (s: TunnelState) => events.push(s));

      await manager.stop();
      expect(manager.getStatus()).toBe("stopped");
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe("stopped");
    });

    it("can be called multiple times after a running tunnel", async () => {
      manager = new TunnelManager({ cliBinary: FAKE_DEVTUNNEL, startupTimeoutMs: 5_000 });
      await manager.start(4002);
      await manager.stop();
      await manager.stop();
      expect(manager.getStatus()).toBe("stopped");
    });
  });

  // ── Full lifecycle tests ───────────────────────────────

  describe("start/stop lifecycle", () => {
    it("full lifecycle: start → running → stop → stopped", async () => {
      manager = new TunnelManager({ cliBinary: FAKE_DEVTUNNEL, startupTimeoutMs: 5_000 });
      const events: string[] = [];
      manager.on("status-change", (s: TunnelState) => events.push(s.status));

      const info = await manager.start(4003);
      expect(info.url).toContain("devtunnels.ms");
      expect(info.tunnelId).toBe("fake-tunnel-abc");
      expect(info.port).toBe(4003);
      expect(manager.getStatus()).toBe("running");

      await manager.stop();
      expect(manager.getStatus()).toBe("stopped");
      expect(manager.getState().info).toBeNull();
      expect(manager.getState().shareUrl).toBeNull();

      expect(events).toEqual(["starting", "running", "stopped"]);
    });

    it("can restart after stop", async () => {
      manager = new TunnelManager({ cliBinary: FAKE_DEVTUNNEL, startupTimeoutMs: 5_000 });

      const info1 = await manager.start(4004);
      expect(manager.getStatus()).toBe("running");
      await manager.stop();
      expect(manager.getStatus()).toBe("stopped");

      const info2 = await manager.start(4005);
      expect(manager.getStatus()).toBe("running");
      expect(info2.port).toBe(4005);
    });

    it("can restart after error", async () => {
      manager = new TunnelManager({ cliBinary: "nonexistent-binary-xyz" });
      try { await manager.start(9999); } catch { /* expected */ }
      expect(manager.getStatus()).toBe("error");

      // New manager simulates CLI becoming available
      manager = new TunnelManager({ cliBinary: FAKE_DEVTUNNEL, startupTimeoutMs: 5_000 });
      const info = await manager.start(4006);
      expect(manager.getStatus()).toBe("running");
      expect(info.url).toContain("devtunnels.ms");
    });
  });

  // ── configured flag tests ──────────────────────────────

  describe("configured flag in state", () => {
    it("is false when stopped", () => {
      manager = new TunnelManager();
      expect(manager.getState().configured).toBe(false);
    });

    it("is false after error", async () => {
      manager = new TunnelManager({ cliBinary: "nonexistent-binary-xyz" });
      try { await manager.start(9999); } catch { /* expected */ }
      expect(manager.getState().configured).toBe(false);
    });

    it("is true when running", async () => {
      manager = new TunnelManager({ cliBinary: FAKE_DEVTUNNEL, startupTimeoutMs: 5_000 });
      await manager.start(4007);
      expect(manager.getState().configured).toBe(true);
    });

    it("returns to false after stop", async () => {
      manager = new TunnelManager({ cliBinary: FAKE_DEVTUNNEL, startupTimeoutMs: 5_000 });
      await manager.start(4008);
      expect(manager.getState().configured).toBe(true);
      await manager.stop();
      expect(manager.getState().configured).toBe(false);
    });
  });

  // ── Status change event tests ──────────────────────────

  describe("status-change events", () => {
    it("emits starting then running on successful start", async () => {
      manager = new TunnelManager({ cliBinary: FAKE_DEVTUNNEL, startupTimeoutMs: 5_000 });
      const events: TunnelState[] = [];
      manager.on("status-change", (s: TunnelState) => events.push({ ...s }));

      await manager.start(4009);
      expect(events).toHaveLength(2);
      expect(events[0].status).toBe("starting");
      expect(events[0].configured).toBe(false);
      expect(events[1].status).toBe("running");
      expect(events[1].configured).toBe(true);
      expect(events[1].shareUrl).toContain("devtunnels.ms");
    });

    it("emits error status on failed start", async () => {
      manager = new TunnelManager({ cliBinary: "nonexistent-binary-xyz" });
      const events: TunnelState[] = [];
      manager.on("status-change", (s: TunnelState) => events.push({ ...s }));

      try { await manager.start(9999); } catch { /* expected */ }
      expect(events.some((e) => e.status === "error")).toBe(true);
    });

    it("stop clears error from state", async () => {
      manager = new TunnelManager({ cliBinary: "nonexistent-binary-xyz" });
      try { await manager.start(9999); } catch { /* expected */ }
      expect(manager.getState().error).toBeTruthy();

      await manager.stop();
      expect(manager.getState().error).toBeNull();
      expect(manager.getState().status).toBe("stopped");
    });
  });
});

describe("tunnelErrorGuidance", () => {
  it("returns install guidance for CLI_NOT_FOUND", () => {
    const err = new TunnelError("not found", "CLI_NOT_FOUND");
    const guidance = tunnelErrorGuidance(err);
    expect(guidance).toContain("Install");
    expect(guidance).toContain("devtunnels/install");
  });

  it("returns login guidance for AUTH_EXPIRED", () => {
    const err = new TunnelError("expired", "AUTH_EXPIRED");
    const guidance = tunnelErrorGuidance(err);
    expect(guidance).toContain("devtunnel user login");
  });

  it("returns timeout guidance for STARTUP_TIMEOUT", () => {
    const err = new TunnelError("timed out", "STARTUP_TIMEOUT");
    const guidance = tunnelErrorGuidance(err);
    expect(guidance).toContain("network");
  });

  it("returns crash guidance for PROCESS_ERROR", () => {
    const err = new TunnelError("crashed", "PROCESS_ERROR");
    const guidance = tunnelErrorGuidance(err);
    expect(guidance).toContain("devtunnel");
  });
});
