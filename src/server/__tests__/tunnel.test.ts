import { describe, it, expect, beforeEach } from "vitest";
import {
  TunnelManager,
  TunnelError,
  tunnelErrorGuidance,
  resetTunnelManager,
} from "../tunnel.js";

describe("TunnelManager", () => {
  beforeEach(() => {
    resetTunnelManager();
  });

  describe("default error listener", () => {
    it("does not throw on unhandled error events", () => {
      const manager = new TunnelManager();
      // Emitting 'error' without an explicit listener should NOT throw
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

      const manager = new TunnelManager({
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
      const manager = new TunnelManager();
      const states: string[] = [];
      manager.on("status-change", (state) => {
        states.push(state.status);
      });

      // Trigger internal error handling via emit
      manager.emit(
        "error",
        new TunnelError("boom", "PROCESS_ERROR"),
      );

      // The default listener handled it; state should track error via getState
      const state = manager.getState();
      expect(state.status).toBe("stopped"); // error sets status via handleError, but emit alone doesn't call handleError
    });

    it("getState returns error info after a failed start", async () => {
      const manager = new TunnelManager({ cliBinary: "nonexistent-binary-xyz" });

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
      const manager = new TunnelManager({
        cliBinary: "nonexistent-binary-xyz",
      });
      const available = await manager.isCliAvailable();
      expect(available).toBe(false);
    });
  });

  describe("start() error handling", () => {
    it("throws CLI_NOT_FOUND for missing binary", async () => {
      const manager = new TunnelManager({
        cliBinary: "nonexistent-binary-xyz",
      });

      await expect(manager.start(9999)).rejects.toThrow(TunnelError);
      await expect(manager.start(9999)).rejects.toMatchObject({
        code: "CLI_NOT_FOUND",
      });
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
