import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { LaunchpadConfig } from "../types.js";
import {
  defaultEnrichmentData,
  defaultLaunchpadConfig,
  defaultProjectConfig,
  defaultUserPreferences,
} from "../types.js";

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
  vi.doUnmock("../local-state-manager.js");
  vi.doUnmock("../state-manager.js");
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
    vi.doMock("../state-manager.js", () => ({
      GitStateManager: class GitStateManager {
        async sync() {
          throw new Error("sync failed");
        }
        async getConfig() {
          return defaultProjectConfig();
        }
        async saveConfig() {}
        async getPreferences() {
          return defaultUserPreferences();
        }
        async savePreferences() {}
        async getEnrichment() {
          return defaultEnrichmentData();
        }
        async saveEnrichment() {}
        async getInbox() {
          throw new Error("not implemented");
        }
        async saveInbox() {
          throw new Error("not implemented");
        }
        async getProjectByToken() {
          return undefined;
        }
        async updateProjectState() {
          return undefined;
        }
        async getProjectDefaultCopilotAgent() {
          return undefined;
        }
        async updateProjectDefaultCopilotAgent() {
          return undefined;
        }
      },
    }));
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

  it("migrates existing local state into git-backed state on reinitialize", async () => {
    writeConfig(defaultLaunchpadConfig());

    const localConfig = {
      version: 1 as const,
      projects: [
        {
          owner: "acme",
          repo: "api",
          addedAt: "2026-01-01T00:00:00Z",
          runtimeTarget: "local" as const,
          initialized: true,
          daemonToken: "token-123",
          workState: "working" as const,
        },
      ],
    };
    const localPreferences = { version: 1 as const, theme: "dark" as const };
    const localEnrichment = {
      version: 1 as const,
      projects: {
        "acme/api": {
          owner: "acme",
          repo: "api",
          devcontainerStatus: "active" as const,
        },
      },
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const gitSync = vi.fn().mockResolvedValue(undefined);
    const gitSaveConfig = vi.fn().mockResolvedValue(undefined);
    const gitSavePreferences = vi.fn().mockResolvedValue(undefined);
    const gitSaveEnrichment = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../local-state-manager.js", () => ({
      LocalStateManager: class LocalStateManager {
        async sync() {}
        async getConfig() {
          return localConfig;
        }
        async saveConfig() {}
        async getPreferences() {
          return localPreferences;
        }
        async savePreferences() {}
        async getEnrichment() {
          return localEnrichment;
        }
        async saveEnrichment() {}
        async getInbox() {
          throw new Error("not implemented");
        }
        async saveInbox() {
          throw new Error("not implemented");
        }
        async getProjectByToken() {
          return undefined;
        }
        async updateProjectState() {
          return undefined;
        }
        async getProjectDefaultCopilotAgent() {
          return undefined;
        }
        async updateProjectDefaultCopilotAgent() {
          return undefined;
        }
      },
    }));

    vi.doMock("../state-manager.js", () => ({
      GitStateManager: class GitStateManager {
        async sync() {
          return gitSync();
        }
        async getConfig() {
          return defaultProjectConfig();
        }
        async saveConfig(config: unknown) {
          return gitSaveConfig(config);
        }
        async getPreferences() {
          return defaultUserPreferences();
        }
        async savePreferences(preferences: unknown) {
          return gitSavePreferences(preferences);
        }
        async getEnrichment() {
          return defaultEnrichmentData();
        }
        async saveEnrichment(enrichment: unknown) {
          return gitSaveEnrichment(enrichment);
        }
        async getInbox() {
          throw new Error("not implemented");
        }
        async saveInbox() {
          throw new Error("not implemented");
        }
        async getProjectByToken() {
          return undefined;
        }
        async updateProjectState() {
          return undefined;
        }
        async getProjectDefaultCopilotAgent() {
          return undefined;
        }
        async updateProjectDefaultCopilotAgent() {
          return undefined;
        }
      },
    }));

    const statePlugin = await importStatePlugin();
    const server = Fastify({ logger: false });
    await server.register(fakeGithubAuth());
    await server.register(statePlugin);
    await server.ready();

    await server.reinitializeStateService({
      ...defaultLaunchpadConfig(),
      stateMode: "git",
      stateRepo: "testuser/launchpad-state",
    });

    expect(gitSaveConfig).toHaveBeenCalledWith(localConfig);
    expect(gitSavePreferences).toHaveBeenCalledWith(localPreferences);
    expect(gitSaveEnrichment).toHaveBeenCalledWith(localEnrichment);
    expect(gitSync).toHaveBeenCalledTimes(2);

    await server.close();
  });

  it("uses the configured stateRepo owner and repo when building git state", async () => {
    writeConfig(defaultLaunchpadConfig());

    const gitCtor = vi.fn(function GitStateManager() {
      return {
        sync: vi.fn().mockResolvedValue(undefined),
        getConfig: vi.fn().mockResolvedValue(defaultProjectConfig()),
        saveConfig: vi.fn().mockResolvedValue(undefined),
        getPreferences: vi.fn().mockResolvedValue(defaultUserPreferences()),
        savePreferences: vi.fn().mockResolvedValue(undefined),
        getEnrichment: vi.fn().mockResolvedValue(defaultEnrichmentData()),
        saveEnrichment: vi.fn().mockResolvedValue(undefined),
        getInbox: vi.fn(),
        saveInbox: vi.fn(),
        getProjectByToken: vi.fn(),
        updateProjectState: vi.fn(),
        getProjectDefaultCopilotAgent: vi.fn(),
        updateProjectDefaultCopilotAgent: vi.fn(),
      };
    });

    vi.doMock("../state-manager.js", () => ({
      GitStateManager: gitCtor,
    }));

    const statePlugin = await importStatePlugin();
    const server = Fastify({ logger: false });
    await server.register(fakeGithubAuth());
    await server.register(statePlugin);
    await server.ready();

    await server.reinitializeStateService({
      ...defaultLaunchpadConfig(),
      stateMode: "git",
      stateRepo: "octo-org/custom-state",
    });

    expect(gitCtor).toHaveBeenCalledWith({
      token: "ghp_fake_test_token",
      owner: "octo-org",
      repo: "custom-state",
    });

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
