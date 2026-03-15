import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LaunchpadConfig, WizardStep } from "../types.js";
import { runWizard } from "../wizard.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  log: {
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock config persistence
vi.mock("../config.js", () => ({
  saveLaunchpadConfig: vi.fn(),
}));

function makeStep(overrides: Partial<WizardStep> & { id: string; title: string }): WizardStep {
  return {
    prompt: vi.fn(async () => ({})),
    validate: vi.fn(() => null),
    apply: vi.fn((config: LaunchpadConfig) => config),
    ...overrides,
  };
}

describe("runWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips all steps and saves defaults in non-interactive mode", async () => {
    const saved: LaunchpadConfig[] = [];
    const result = await runWizard({
      steps: [makeStep({ id: "test", title: "Test Step" })],
      interactive: false,
      onSave: (c) => { saved.push(c); },
    });

    expect(result.skipped).toBe(true);
    expect(result.config.onboardingComplete).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0].onboardingComplete).toBe(true);
  });

  it("runs steps and applies values in interactive mode", async () => {
    const clack = await import("@clack/prompts");
    vi.mocked(clack.confirm).mockResolvedValue(true);

    const applyFn = vi.fn((config: LaunchpadConfig, values: Record<string, unknown>) => ({
      ...config,
      stateMode: values.mode as "local" | "git",
    }));

    const step = makeStep({
      id: "state-mode",
      title: "State Mode",
      prompt: vi.fn(async () => ({ mode: "git" })),
      apply: applyFn,
    });

    const saved: LaunchpadConfig[] = [];
    const result = await runWizard({
      steps: [step],
      interactive: true,
      onSave: (c) => { saved.push(c); },
    });

    expect(result.skipped).toBe(false);
    expect(step.prompt).toHaveBeenCalled();
    expect(applyFn).toHaveBeenCalled();
    expect(result.config.stateMode).toBe("git");
    expect(result.config.onboardingComplete).toBe(true);
    expect(saved).toHaveLength(1);
  });

  it("skips a step when user declines", async () => {
    const clack = await import("@clack/prompts");
    vi.mocked(clack.confirm).mockResolvedValueOnce(false);

    const step = makeStep({ id: "skip-me", title: "Skip Me" });
    const saved: LaunchpadConfig[] = [];

    await runWizard({
      steps: [step],
      interactive: true,
      onSave: (c) => { saved.push(c); },
    });

    expect(step.prompt).not.toHaveBeenCalled();
    expect(step.apply).not.toHaveBeenCalled();
    expect(saved[0].onboardingComplete).toBe(true);
  });

  it("handles cancel during step confirmation", async () => {
    const clack = await import("@clack/prompts");
    const cancelSymbol = Symbol("cancel");
    vi.mocked(clack.confirm).mockResolvedValueOnce(cancelSymbol as unknown as boolean);
    vi.mocked(clack.isCancel).mockImplementation((val) => val === cancelSymbol);

    const step = makeStep({ id: "cancel-me", title: "Cancel Me" });
    const saved: LaunchpadConfig[] = [];

    const result = await runWizard({
      steps: [step],
      interactive: true,
      onSave: (c) => { saved.push(c); },
    });

    expect(result.skipped).toBe(true);
    expect(clack.cancel).toHaveBeenCalled();
    expect(saved[0].onboardingComplete).toBe(true);
  });

  it("handles validation errors gracefully", async () => {
    const clack = await import("@clack/prompts");
    vi.mocked(clack.confirm).mockResolvedValue(true);

    const step = makeStep({
      id: "bad-step",
      title: "Bad Step",
      validate: vi.fn(() => "Invalid value"),
    });

    const saved: LaunchpadConfig[] = [];
    await runWizard({
      steps: [step],
      interactive: true,
      onSave: (c) => { saved.push(c); },
    });

    expect(clack.log.warning).toHaveBeenCalledWith("Invalid value");
    expect(step.apply).not.toHaveBeenCalled();
    expect(saved[0].onboardingComplete).toBe(true);
  });

  it("runs multiple steps in sequence", async () => {
    const clack = await import("@clack/prompts");
    vi.mocked(clack.confirm).mockResolvedValue(true);

    const order: string[] = [];
    const step1 = makeStep({
      id: "step-1",
      title: "Step 1",
      prompt: vi.fn(async () => { order.push("1"); return {}; }),
    });
    const step2 = makeStep({
      id: "step-2",
      title: "Step 2",
      prompt: vi.fn(async () => { order.push("2"); return {}; }),
    });

    await runWizard({
      steps: [step1, step2],
      interactive: true,
      onSave: () => {},
    });

    expect(order).toEqual(["1", "2"]);
  });
});
