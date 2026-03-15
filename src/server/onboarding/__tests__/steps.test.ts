import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defaultLaunchpadConfig } from "../types.js";

// Mock @clack/prompts before importing steps
vi.mock("@clack/prompts", () => ({
  note: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  log: {
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import {
  defaultSteps,
  stateModeStep,
  copilotPrefStep,
  modelStep,
  devtunnelStep,
  AVAILABLE_MODELS,
} from "../steps.js";

describe("onboarding steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Registration ──────────────────────────────────────────────────────────

  it("registers 4 default steps", () => {
    expect(defaultSteps).toHaveLength(4);
  });

  it("each step has required properties", () => {
    for (const step of defaultSteps) {
      expect(step.id).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(typeof step.prompt).toBe("function");
      expect(typeof step.validate).toBe("function");
      expect(typeof step.apply).toBe("function");
    }
  });

  it("step ids are state-mode, copilot-pref, model, devtunnel", () => {
    const ids = defaultSteps.map((s) => s.id);
    expect(ids).toEqual(["state-mode", "copilot-pref", "model", "devtunnel"]);
  });

  // ── Step 1: State storage mode (#41) ──────────────────────────────────────

  describe("stateModeStep", () => {
    it("prompts and returns selected mode", async () => {
      const clack = await import("@clack/prompts");
      vi.mocked(clack.select).mockResolvedValueOnce("git");

      const result = await stateModeStep.prompt();
      expect(result).toEqual({ mode: "git" });
      expect(clack.note).toHaveBeenCalled();
      expect(clack.select).toHaveBeenCalled();
    });

    it("validates 'local' as valid", () => {
      expect(stateModeStep.validate({ mode: "local" })).toBeNull();
    });

    it("validates 'git' as valid", () => {
      expect(stateModeStep.validate({ mode: "git" })).toBeNull();
    });

    it("rejects invalid mode", () => {
      expect(stateModeStep.validate({ mode: "cloud" })).toBeTruthy();
    });

    it("rejects missing mode", () => {
      expect(stateModeStep.validate({})).toBeTruthy();
    });

    it("applies local mode to config", () => {
      const config = defaultLaunchpadConfig();
      const result = stateModeStep.apply(config, { mode: "local" });
      expect(result.stateMode).toBe("local");
    });

    it("applies git mode to config", () => {
      const config = defaultLaunchpadConfig();
      const result = stateModeStep.apply(config, { mode: "git" });
      expect(result.stateMode).toBe("git");
    });

    it("does not mutate the original config", () => {
      const config = defaultLaunchpadConfig();
      const result = stateModeStep.apply(config, { mode: "git" });
      expect(result).not.toBe(config);
      expect(config.stateMode).toBe("local");
    });
  });

  // ── Step 2: Copilot session preference (#42) ─────────────────────────────

  describe("copilotPrefStep", () => {
    it("prompts and returns selected session type", async () => {
      const clack = await import("@clack/prompts");
      vi.mocked(clack.select).mockResolvedValueOnce("cli");

      const result = await copilotPrefStep.prompt();
      expect(result).toEqual({ sessionType: "cli" });
      expect(clack.note).toHaveBeenCalled();
    });

    it("validates 'sdk' as valid", () => {
      expect(copilotPrefStep.validate({ sessionType: "sdk" })).toBeNull();
    });

    it("validates 'cli' as valid", () => {
      expect(copilotPrefStep.validate({ sessionType: "cli" })).toBeNull();
    });

    it("rejects invalid session type", () => {
      expect(copilotPrefStep.validate({ sessionType: "magic" })).toBeTruthy();
    });

    it("applies sdk session type to config", () => {
      const config = defaultLaunchpadConfig();
      const result = copilotPrefStep.apply(config, { sessionType: "sdk" });
      expect(result.copilot.defaultSessionType).toBe("sdk");
    });

    it("applies cli session type to config", () => {
      const config = defaultLaunchpadConfig();
      const result = copilotPrefStep.apply(config, { sessionType: "cli" });
      expect(result.copilot.defaultSessionType).toBe("cli");
    });

    it("preserves other copilot config fields", () => {
      const config = defaultLaunchpadConfig();
      const result = copilotPrefStep.apply(config, { sessionType: "cli" });
      expect(result.copilot.defaultModel).toBe(config.copilot.defaultModel);
    });
  });

  // ── Step 3: Default model (#43) ──────────────────────────────────────────

  describe("modelStep", () => {
    it("prompts and returns selected model", async () => {
      const clack = await import("@clack/prompts");
      vi.mocked(clack.select).mockResolvedValueOnce("gpt-5.2");

      const result = await modelStep.prompt();
      expect(result).toEqual({ model: "gpt-5.2" });
      expect(clack.note).toHaveBeenCalled();
    });

    it("validates a known model as valid", () => {
      expect(modelStep.validate({ model: "claude-opus-4.6" })).toBeNull();
    });

    it("rejects unknown model", () => {
      expect(modelStep.validate({ model: "unknown-model" })).toBeTruthy();
    });

    it("rejects missing model", () => {
      expect(modelStep.validate({})).toBeTruthy();
    });

    it("applies selected model to config", () => {
      const config = defaultLaunchpadConfig();
      const result = modelStep.apply(config, { model: "gpt-5.2" });
      expect(result.copilot.defaultModel).toBe("gpt-5.2");
    });

    it("preserves other copilot config fields", () => {
      const config = defaultLaunchpadConfig();
      const result = modelStep.apply(config, { model: "gpt-5.1" });
      expect(result.copilot.defaultSessionType).toBe(config.copilot.defaultSessionType);
    });

    it("AVAILABLE_MODELS includes claude-opus-4.6 as first option", () => {
      expect(AVAILABLE_MODELS[0].value).toBe("claude-opus-4.6");
    });

    it("AVAILABLE_MODELS has at least 5 options", () => {
      expect(AVAILABLE_MODELS.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ── Step 4: Devtunnel (placeholder) ──────────────────────────────────────

  describe("devtunnelStep (placeholder)", () => {
    it("prompt returns empty object", async () => {
      const result = await devtunnelStep.prompt();
      expect(result).toEqual({});
    });

    it("validate returns null", () => {
      expect(devtunnelStep.validate({})).toBeNull();
    });

    it("apply returns config unchanged", () => {
      const config = defaultLaunchpadConfig();
      const result = devtunnelStep.apply(config, {});
      expect(result).toEqual(config);
    });
  });
});
