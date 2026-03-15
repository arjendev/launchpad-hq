import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { LaunchpadConfig } from "../types.js";
import { defaultLaunchpadConfig } from "../types.js";

let tmpDir: string;
let configPath: string;

function writeConfig(config: LaunchpadConfig) {
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function importStatePlugin() {
  vi.resetModules();
  vi.doMock("../launchpad-config.js", () => ({
    loadLaunchpadConfig: () =>
      import("node:fs/promises")
        .then((fs) => fs.readFile(configPath, "utf-8"))
        .then((raw) => ({
          ...defaultLaunchpadConfig(),
          ...JSON.parse(raw),
        })),
    saveLaunchpadConfig: (config: LaunchpadConfig) =>
      import("node:fs/promises").then((fs) =>
        fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8"),
      ),
    LAUNCHPAD_CONFIG_PATH: configPath,
  }));

  return (await import("../plugin.js")).default;
}

/**
 * Stub the github-auth dependency that the state plugin requires.
 * Uses fastify-plugin so the decorator is visible in the parent scope.
 */
function fakeGithubAuth() {
  return fp(
    async (fastify: FastifyInstance) => {
      fastify.decorate("githubToken", "ghp_fake_test_token");
      fastify.decorate("githubUser", { login: "testuser" });
    },
    { name: "github-auth" },
  );
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lp-plugin-test-"));
  configPath = join(tmpDir, "config.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("statePlugin", () => {
  it("boots with local mode when config says local", async () => {
    writeConfig({ ...defaultLaunchpadConfig(), stateMode: "local" });
    const statePlugin = await importStatePlugin();

    const server = Fastify({ logger: false });
    await server.register(fakeGithubAuth());
    await server.register(statePlugin);
    await server.ready();

    expect(server.stateService).toBeDefined();
    expect(server.launchpadConfig.stateMode).toBe("local");
    // The stateService should be a LocalStateManager
    expect(server.stateService.constructor.name).toBe("LocalStateManager");

    await server.close();
  });

  it("exposes reinitializeStateService on the server", async () => {
    writeConfig(defaultLaunchpadConfig());
    const statePlugin = await importStatePlugin();

    const server = Fastify({ logger: false });
    await server.register(fakeGithubAuth());
    await server.register(statePlugin);
    await server.ready();

    expect(server.reinitializeStateService).toBeDefined();
    expect(typeof server.reinitializeStateService).toBe("function");

    await server.close();
  });

  it("reinitializeStateService swaps local → local with new config", async () => {
    writeConfig(defaultLaunchpadConfig());
    const statePlugin = await importStatePlugin();

    const server = Fastify({ logger: false });
    await server.register(fakeGithubAuth());
    await server.register(statePlugin);
    await server.ready();

    const originalService = server.stateService;
    expect(originalService.constructor.name).toBe("LocalStateManager");

    // Reinitialize with a fresh local config
    const newConfig: LaunchpadConfig = {
      ...defaultLaunchpadConfig(),
      stateMode: "local",
    };
    await server.reinitializeStateService(newConfig);

    // Service should be a new instance
    expect(server.stateService.constructor.name).toBe("LocalStateManager");
    expect(server.stateService).not.toBe(originalService);
    expect(server.launchpadConfig.stateMode).toBe("local");

    await server.close();
  });

  it("reinitializeStateService swaps local → git (gracefully handles sync failure)", async () => {
    writeConfig(defaultLaunchpadConfig());
    const statePlugin = await importStatePlugin();

    const server = Fastify({ logger: false });
    await server.register(fakeGithubAuth());
    await server.register(statePlugin);
    await server.ready();

    expect(server.stateService.constructor.name).toBe("LocalStateManager");

    // Switch to git mode — sync will fail since there's no real GitHub repo,
    // but it should NOT crash; it should fall back to defaults.
    const gitConfig: LaunchpadConfig = {
      ...defaultLaunchpadConfig(),
      stateMode: "git",
      stateRepo: "testuser/launchpad-state",
    };

    await server.reinitializeStateService(gitConfig);

    // The service should now be a GitStateManager (even if sync failed)
    expect(server.stateService.constructor.name).toBe("GitStateManager");
    expect(server.launchpadConfig.stateMode).toBe("git");

    // And it should still work — getConfig returns defaults
    const config = await server.stateService.getConfig();
    expect(config).toBeDefined();
    expect(config.projects).toBeDefined();

    await server.close();
  });

  it("launchpadConfig is updated after reinitialize", async () => {
    writeConfig(defaultLaunchpadConfig());
    const statePlugin = await importStatePlugin();

    const server = Fastify({ logger: false });
    await server.register(fakeGithubAuth());
    await server.register(statePlugin);
    await server.ready();

    const originalOnboarding = server.launchpadConfig.onboardingComplete;

    // Flip the value so the test always detects a change
    const updatedConfig: LaunchpadConfig = {
      ...defaultLaunchpadConfig(),
      stateMode: "local",
      onboardingComplete: !originalOnboarding,
    };
    await server.reinitializeStateService(updatedConfig);

    expect(server.launchpadConfig.onboardingComplete).toBe(!originalOnboarding);

    await server.close();
  });
});
