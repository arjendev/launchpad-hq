import { describe, it, expect } from "vitest";
import { defaultSteps } from "../steps.js";
import { defaultLaunchpadConfig } from "../types.js";

describe("placeholder steps", () => {
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

  it("placeholder prompts return empty object", async () => {
    for (const step of defaultSteps) {
      const result = await step.prompt();
      expect(result).toEqual({});
    }
  });

  it("placeholder validate returns null (valid)", () => {
    for (const step of defaultSteps) {
      expect(step.validate({})).toBeNull();
    }
  });

  it("placeholder apply returns config unchanged", () => {
    const config = defaultLaunchpadConfig();
    for (const step of defaultSteps) {
      const result = step.apply(config, {});
      expect(result).toEqual(config);
    }
  });
});
