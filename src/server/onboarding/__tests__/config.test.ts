import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { configExists, getConfigPath, getConfigDir } from "../config.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock-home"),
}));

// Mock the re-exported state module
vi.mock("../../state/launchpad-config.js", () => ({
  loadLaunchpadConfig: vi.fn(),
  saveLaunchpadConfig: vi.fn(),
  LAUNCHPAD_CONFIG_PATH: "/mock-home/.launchpad/config.json",
}));

describe("onboarding config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getConfigDir / getConfigPath", () => {
    it("returns paths under ~/.launchpad", () => {
      expect(getConfigDir()).toBe("/mock-home/.launchpad");
      expect(getConfigPath()).toBe("/mock-home/.launchpad/config.json");
    });
  });

  describe("configExists", () => {
    it("returns true when config file exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      expect(configExists()).toBe(true);
    });

    it("returns false when config file is missing", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(configExists()).toBe(false);
    });
  });
});
