import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defaultLaunchpadConfig } from "../types.js";
import type { DevtunnelOps } from "../devtunnel-ops.js";

// Mock @clack/prompts before importing steps
const mockSpinner = { start: vi.fn(), stop: vi.fn() };

vi.mock("@clack/prompts", () => ({
  note: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  spinner: vi.fn(() => mockSpinner),
  log: {
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import * as p from "@clack/prompts";
import { createDevtunnelStep } from "../steps.js";

function mockOps(overrides: Partial<DevtunnelOps> = {}): DevtunnelOps {
  return {
    isCliInstalled: vi.fn(async () => true),
    isAuthenticated: vi.fn(async () => false),
    waitForAuth: vi.fn(async () => false),
    ...overrides,
  };
}

describe("devtunnelStep (behavioral)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── On-demand mode ──────────────────────────────────────────────────────

  describe("on-demand mode", () => {
    it("returns on-demand when user selects it", async () => {
      vi.mocked(p.select).mockResolvedValueOnce("on-demand");
      const step = createDevtunnelStep(mockOps());

      const result = await step.prompt();

      expect(result).toEqual({ mode: "on-demand", configured: false });
      expect(p.note).toHaveBeenCalled(); // explanation shown
      expect(p.select).toHaveBeenCalled();
    });

    it("does not check CLI or auth for on-demand", async () => {
      const ops = mockOps();
      vi.mocked(p.select).mockResolvedValueOnce("on-demand");
      const step = createDevtunnelStep(ops);

      await step.prompt();

      expect(ops.isCliInstalled).not.toHaveBeenCalled();
      expect(ops.isAuthenticated).not.toHaveBeenCalled();
    });
  });

  // ── Cancel handling ─────────────────────────────────────────────────────

  describe("cancellation", () => {
    it("falls back to on-demand when user cancels mode selection", async () => {
      const cancelSymbol = Symbol("cancel");
      vi.mocked(p.select).mockResolvedValueOnce(cancelSymbol as unknown as string);
      vi.mocked(p.isCancel).mockImplementation((val) => val === cancelSymbol);
      const step = createDevtunnelStep(mockOps());

      const result = await step.prompt();

      expect(result).toEqual({ mode: "on-demand", configured: false });
    });

    it("falls back to on-demand when user cancels auth confirmation", async () => {
      const ops = mockOps({ isCliInstalled: vi.fn(async () => true) });
      const cancelSymbol = Symbol("cancel");
      vi.mocked(p.select).mockResolvedValueOnce("always");
      vi.mocked(p.confirm).mockResolvedValueOnce(cancelSymbol as unknown as boolean);
      vi.mocked(p.isCancel).mockImplementation((val) => val === cancelSymbol);
      const step = createDevtunnelStep(ops);

      const result = await step.prompt();

      expect(result).toEqual({ mode: "on-demand", configured: false });
    });
  });

  // ── Always mode: CLI not installed ──────────────────────────────────────

  describe("always mode — CLI not installed", () => {
    it("falls back to on-demand with guidance", async () => {
      const ops = mockOps({ isCliInstalled: vi.fn(async () => false) });
      vi.mocked(p.select).mockResolvedValueOnce("always");
      const step = createDevtunnelStep(ops);

      const result = await step.prompt();

      expect(result).toEqual({ mode: "on-demand", configured: false });
      expect(mockSpinner.start).toHaveBeenCalledWith(expect.stringContaining("CLI"));
      expect(mockSpinner.stop).toHaveBeenCalledWith(expect.stringContaining("not found"));
      expect(p.log.warning).toHaveBeenCalled();
      expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("aka.ms"));
    });

    it("does not check auth or offer login", async () => {
      const ops = mockOps({ isCliInstalled: vi.fn(async () => false) });
      vi.mocked(p.select).mockResolvedValueOnce("always");
      const step = createDevtunnelStep(ops);

      await step.prompt();

      expect(ops.isAuthenticated).not.toHaveBeenCalled();
      expect(ops.waitForAuth).not.toHaveBeenCalled();
    });
  });

  // ── Always mode: already authenticated ─────────────────────────────────

  describe("always mode — already authenticated", () => {
    it("returns always+configured without prompting for login", async () => {
      const ops = mockOps({
        isCliInstalled: vi.fn(async () => true),
        isAuthenticated: vi.fn(async () => true),
      });
      vi.mocked(p.select).mockResolvedValueOnce("always");
      const step = createDevtunnelStep(ops);

      const result = await step.prompt();

      expect(result).toEqual({ mode: "always", configured: true });
      expect(p.confirm).not.toHaveBeenCalled();
      expect(ops.waitForAuth).not.toHaveBeenCalled();
    });
  });

  // ── Always mode: not authenticated, user configures now ────────────────

  describe("always mode — auth flow", () => {
    it("returns always+configured when auth succeeds", async () => {
      const ops = mockOps({
        isCliInstalled: vi.fn(async () => true),
        isAuthenticated: vi.fn(async () => false),
        waitForAuth: vi.fn(async () => true),
      });
      vi.mocked(p.select).mockResolvedValueOnce("always");
      vi.mocked(p.confirm).mockResolvedValueOnce(true);
      const step = createDevtunnelStep(ops);

      const result = await step.prompt();

      expect(result).toEqual({ mode: "always", configured: true });
      expect(ops.waitForAuth).toHaveBeenCalled();
      // Should show auth instructions
      expect(p.note).toHaveBeenCalledTimes(2); // explanation + auth note
    });

    it("falls back to on-demand when auth times out", async () => {
      const ops = mockOps({
        isCliInstalled: vi.fn(async () => true),
        isAuthenticated: vi.fn(async () => false),
        waitForAuth: vi.fn(async () => false),
      });
      vi.mocked(p.select).mockResolvedValueOnce("always");
      vi.mocked(p.confirm).mockResolvedValueOnce(true);
      const step = createDevtunnelStep(ops);

      const result = await step.prompt();

      expect(result).toEqual({ mode: "on-demand", configured: false });
      expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("on-demand"));
      expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("devtunnel user login"));
    });

    it("falls back to on-demand when user declines auth", async () => {
      const ops = mockOps({
        isCliInstalled: vi.fn(async () => true),
        isAuthenticated: vi.fn(async () => false),
      });
      vi.mocked(p.select).mockResolvedValueOnce("always");
      vi.mocked(p.confirm).mockResolvedValueOnce(false);
      const step = createDevtunnelStep(ops);

      const result = await step.prompt();

      expect(result).toEqual({ mode: "on-demand", configured: false });
      expect(ops.waitForAuth).not.toHaveBeenCalled();
      expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("on-demand"));
    });
  });

  // ── Error handling (never crash) ───────────────────────────────────────

  describe("error handling", () => {
    it("falls back to on-demand when CLI check throws", async () => {
      const ops = mockOps({
        isCliInstalled: vi.fn(async () => { throw new Error("exec failed"); }),
      });
      vi.mocked(p.select).mockResolvedValueOnce("always");
      const step = createDevtunnelStep(ops);

      const result = await step.prompt();

      expect(result).toEqual({ mode: "on-demand", configured: false });
      expect(p.log.warning).toHaveBeenCalledWith(expect.stringContaining("went wrong"));
    });

    it("falls back to on-demand when auth check throws", async () => {
      const ops = mockOps({
        isCliInstalled: vi.fn(async () => true),
        isAuthenticated: vi.fn(async () => { throw new Error("auth check failed"); }),
      });
      vi.mocked(p.select).mockResolvedValueOnce("always");
      const step = createDevtunnelStep(ops);

      const result = await step.prompt();

      expect(result).toEqual({ mode: "on-demand", configured: false });
      expect(p.log.warning).toHaveBeenCalled();
    });

    it("falls back to on-demand when waitForAuth throws", async () => {
      const ops = mockOps({
        isCliInstalled: vi.fn(async () => true),
        isAuthenticated: vi.fn(async () => false),
        waitForAuth: vi.fn(async () => { throw new Error("poll failed"); }),
      });
      vi.mocked(p.select).mockResolvedValueOnce("always");
      vi.mocked(p.confirm).mockResolvedValueOnce(true);
      const step = createDevtunnelStep(ops);

      const result = await step.prompt();

      expect(result).toEqual({ mode: "on-demand", configured: false });
      expect(p.log.warning).toHaveBeenCalled();
    });
  });

  // ── Validate ───────────────────────────────────────────────────────────

  describe("validate", () => {
    const step = createDevtunnelStep(mockOps());

    it("accepts on-demand + unconfigured", () => {
      expect(step.validate({ mode: "on-demand", configured: false })).toBeNull();
    });

    it("accepts always + configured", () => {
      expect(step.validate({ mode: "always", configured: true })).toBeNull();
    });

    it("accepts always + unconfigured", () => {
      expect(step.validate({ mode: "always", configured: false })).toBeNull();
    });

    it("rejects unknown mode", () => {
      expect(step.validate({ mode: "manual", configured: false })).toBeTruthy();
    });

    it("rejects missing mode", () => {
      expect(step.validate({ configured: false })).toBeTruthy();
    });

    it("rejects missing configured", () => {
      expect(step.validate({ mode: "always" })).toBeTruthy();
    });

    it("rejects non-boolean configured", () => {
      expect(step.validate({ mode: "always", configured: "yes" })).toBeTruthy();
    });
  });

  // ── Apply ──────────────────────────────────────────────────────────────

  describe("apply", () => {
    const step = createDevtunnelStep(mockOps());

    it("sets tunnel.mode and tunnel.configured", () => {
      const config = defaultLaunchpadConfig();
      const result = step.apply(config, { mode: "always", configured: true });

      expect(result.tunnel).toEqual({ mode: "always", configured: true });
    });

    it("returns a new config object (no mutation)", () => {
      const config = defaultLaunchpadConfig();
      const result = step.apply(config, { mode: "always", configured: true });

      expect(result).not.toBe(config);
      expect(config.tunnel.mode).toBe("on-demand"); // original unchanged
    });

    it("preserves other config fields", () => {
      const config = defaultLaunchpadConfig();
      config.stateMode = "git";
      const result = step.apply(config, { mode: "always", configured: true });

      expect(result.stateMode).toBe("git");
      expect(result.copilot).toEqual(config.copilot);
    });
  });
});
