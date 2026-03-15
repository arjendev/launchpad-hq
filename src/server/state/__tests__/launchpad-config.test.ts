import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadLaunchpadConfig,
  saveLaunchpadConfig,
} from "../launchpad-config.js";
import { defaultLaunchpadConfig } from "../types.js";

describe("launchpad-config", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "launchpad-cfg-test-"));
    configPath = join(tmpDir, "config.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadLaunchpadConfig()", () => {
    it("returns defaults when config file does not exist", async () => {
      const config = await loadLaunchpadConfig(configPath);
      expect(config).toEqual(defaultLaunchpadConfig());
    });

    it("reads an existing config file", async () => {
      const data = { ...defaultLaunchpadConfig(), stateMode: "git" as const };
      writeFileSync(configPath, JSON.stringify(data), "utf-8");

      const config = await loadLaunchpadConfig(configPath);
      expect(config.stateMode).toBe("git");
    });

    it("merges partial config with defaults", async () => {
      writeFileSync(configPath, JSON.stringify({ stateMode: "git" }), "utf-8");

      const config = await loadLaunchpadConfig(configPath);
      expect(config.stateMode).toBe("git");
      expect(config.version).toBe(1);
    });

    it("returns defaults for malformed JSON", async () => {
      writeFileSync(configPath, "not json", "utf-8");

      const config = await loadLaunchpadConfig(configPath);
      expect(config).toEqual(defaultLaunchpadConfig());
    });
  });

  describe("saveLaunchpadConfig()", () => {
    it("creates the file and parent directories", async () => {
      const nested = join(tmpDir, "deep", "nested", "config.json");
      const config = { ...defaultLaunchpadConfig(), stateMode: "git" as const };

      await saveLaunchpadConfig(config, nested);

      const loaded = await loadLaunchpadConfig(nested);
      expect(loaded.stateMode).toBe("git");
    });

    it("round-trips the full config", async () => {
      const config = defaultLaunchpadConfig();
      config.stateMode = "git";

      await saveLaunchpadConfig(config, configPath);
      const loaded = await loadLaunchpadConfig(configPath);

      expect(loaded).toEqual(config);
    });
  });
});
