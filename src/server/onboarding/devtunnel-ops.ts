/**
 * DevTunnel CLI operations for the onboarding wizard.
 * Extracted behind an interface for testability — tests inject mocks,
 * production code uses the real CLI via createDevtunnelOps().
 */

import { execFile } from "node:child_process";

export interface DevtunnelOps {
  /** Check if the `devtunnel` CLI binary is on PATH. */
  isCliInstalled(): Promise<boolean>;
  /** Check if the user is authenticated (`devtunnel user show` exits 0). */
  isAuthenticated(): Promise<boolean>;
  /** Poll `isAuthenticated()` until it returns true or timeout expires. */
  waitForAuth(timeoutMs?: number, pollIntervalMs?: number): Promise<boolean>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDevtunnelOps(binary = "devtunnel"): DevtunnelOps {
  const ops: DevtunnelOps = {
    async isCliInstalled(): Promise<boolean> {
      return new Promise((resolve) => {
        execFile(binary, ["--version"], { timeout: 5_000 }, (err) => {
          resolve(!err);
        });
      });
    },

    async isAuthenticated(): Promise<boolean> {
      return new Promise((resolve) => {
        execFile(binary, ["user", "show"], { timeout: 10_000 }, (err) => {
          resolve(!err);
        });
      });
    },

    async waitForAuth(
      timeoutMs = 120_000,
      pollIntervalMs = 3_000,
    ): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const authed = await ops.isAuthenticated();
        if (authed) return true;
        await sleep(pollIntervalMs);
      }
      return false;
    },
  };

  return ops;
}
