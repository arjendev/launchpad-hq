import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateManager } from "../state-manager.js";
import type { GitHubStateClient } from "../github-state-client.js";
import type { LocalCache } from "../local-cache.js";
import type { ProjectConfig, ProjectEntry, EnrichmentData, UserPreferences, LaunchpadConfig } from "../types.js";
import { defaultLaunchpadConfig } from "../types.js";

/** Build a full ProjectEntry with sensible defaults. */
function makeProject(overrides: Partial<ProjectEntry> & Pick<ProjectEntry, "owner" | "repo">): ProjectEntry {
  return {
    addedAt: "2026-01-01T00:00:00Z",
    runtimeTarget: "local",
    initialized: false,
    daemonToken: "test-token-" + overrides.owner + "-" + overrides.repo,
    workState: "stopped",
    ...overrides,
  };
}

function createMocks() {
  const client = {
    ensureRepo: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(null),
    writeFile: vi.fn().mockResolvedValue("new-sha-123"),
  } as unknown as GitHubStateClient & {
    ensureRepo: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
  };

  const cache = {
    read: vi.fn().mockResolvedValue(null),
    write: vi.fn().mockResolvedValue(undefined),
  } as unknown as LocalCache & {
    read: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };

  const manager = new StateManager({
    token: "ghp_test",
    owner: "testuser",
    deps: { client: client as unknown as GitHubStateClient, cache: cache as unknown as LocalCache },
  });

  return { manager, client, cache };
}

describe("StateManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- sync -----------------------------------------------------------------

  describe("sync()", () => {
    it("ensures repo exists and pulls all state files", async () => {
      const { manager, client } = createMocks();

      await manager.sync();

      expect(client.ensureRepo).toHaveBeenCalledOnce();
      // Should try to read all four state files (including launchpad-config.json)
      expect(client.readFile).toHaveBeenCalledWith("config.json");
      expect(client.readFile).toHaveBeenCalledWith("preferences.json");
      expect(client.readFile).toHaveBeenCalledWith("enrichment.json");
      expect(client.readFile).toHaveBeenCalledWith("launchpad-config.json");
    });

    it("writes pulled files to local cache", async () => {
      const { manager, client, cache } = createMocks();

      const configContent = JSON.stringify({ version: 1, projects: [] });
      client.readFile.mockImplementation(async (path: string) => {
        if (path === "config.json") {
          return { sha: "abc123", content: configContent, path };
        }
        return null;
      });

      await manager.sync();

      expect(cache.write).toHaveBeenCalledWith(
        "config.json",
        configContent,
        "abc123",
      );
    });
  });

  // ---- getConfig / saveConfig ------------------------------------------------

  describe("getConfig()", () => {
    it("returns default config when nothing exists", async () => {
      const { manager } = createMocks();

      const config = await manager.getConfig();

      expect(config).toEqual({ version: 1, projects: [] });
    });

    it("reads from local cache first", async () => {
      const { manager, cache, client } = createMocks();

      const stored: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "acme", repo: "widget" })],
      };
      cache.read.mockResolvedValue({
        content: JSON.stringify(stored),
        sha: "cached-sha",
      });

      const config = await manager.getConfig();

      expect(config).toEqual(stored);
      // Should NOT have hit GitHub
      expect(client.readFile).not.toHaveBeenCalled();
    });

    it("falls back to GitHub when cache is empty", async () => {
      const { manager, client, cache } = createMocks();

      const stored: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "acme", repo: "api", addedAt: "2026-02-01T00:00:00Z" })],
      };
      client.readFile.mockResolvedValue({
        sha: "remote-sha",
        content: JSON.stringify(stored),
        path: "config.json",
      });

      const config = await manager.getConfig();

      expect(config).toEqual(stored);
      expect(client.readFile).toHaveBeenCalledWith("config.json");
      // Should populate cache
      expect(cache.write).toHaveBeenCalledWith(
        "config.json",
        JSON.stringify(stored),
        "remote-sha",
      );
    });
  });

  describe("saveConfig()", () => {
    it("writes to GitHub then updates cache", async () => {
      const { manager, client, cache } = createMocks();

      // Simulate existing file with known SHA in cache
      cache.read.mockResolvedValue({ content: "{}", sha: "old-sha" });

      const config: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "acme", repo: "ui", addedAt: "2026-03-01T00:00:00Z" })],
      };
      await manager.saveConfig(config);

      const expectedContent = JSON.stringify(config, null, 2) + "\n";

      expect(client.writeFile).toHaveBeenCalledWith(
        "config.json",
        expectedContent,
        "old-sha",
      );
      expect(cache.write).toHaveBeenCalledWith(
        "config.json",
        expectedContent,
        "new-sha-123",
      );
    });

    it("creates a new file when no SHA exists", async () => {
      const { manager, client } = createMocks();

      const config: ProjectConfig = { version: 1, projects: [] };
      await manager.saveConfig(config);

      // No sha passed (undefined)
      expect(client.writeFile).toHaveBeenCalledWith(
        "config.json",
        JSON.stringify(config, null, 2) + "\n",
        undefined,
      );
    });
  });

  // ---- getPreferences / savePreferences --------------------------------------

  describe("getPreferences()", () => {
    it("returns defaults when nothing stored", async () => {
      const { manager } = createMocks();

      const prefs = await manager.getPreferences();

      expect(prefs).toEqual({ version: 1, theme: "system" });
    });
  });

  describe("savePreferences()", () => {
    it("writes preferences to GitHub", async () => {
      const { manager, client } = createMocks();

      const prefs: UserPreferences = { version: 1, theme: "dark" };
      await manager.savePreferences(prefs);

      expect(client.writeFile).toHaveBeenCalledWith(
        "preferences.json",
        JSON.stringify(prefs, null, 2) + "\n",
        undefined,
      );
    });
  });

  // ---- getEnrichment / saveEnrichment ----------------------------------------

  describe("getEnrichment()", () => {
    it("returns defaults when nothing stored", async () => {
      const { manager } = createMocks();

      const enrichment = await manager.getEnrichment();

      expect(enrichment.version).toBe(1);
      expect(enrichment.projects).toEqual({});
    });
  });

  describe("saveEnrichment()", () => {
    it("stamps updatedAt and writes to GitHub", async () => {
      const { manager, client } = createMocks();

      const data: EnrichmentData = {
        version: 1,
        projects: {
          "acme/api": {
            owner: "acme",
            repo: "api",
            devcontainerStatus: "active",
            lastEnrichedAt: "2026-03-01T00:00:00Z",
          },
        },
        updatedAt: "old",
      };

      await manager.saveEnrichment(data);

      // updatedAt should have been refreshed
      const written = JSON.parse(
        (client.writeFile.mock.calls[0] as [string, string])[1],
      ) as EnrichmentData;
      expect(written.updatedAt).not.toBe("old");
      expect(written.projects["acme/api"].devcontainerStatus).toBe("active");
    });
  });

  // ---- getProjectByToken ----------------------------------------------------

  describe("getProjectByToken()", () => {
    it("returns the matching project", async () => {
      const { manager, cache } = createMocks();

      const stored: ProjectConfig = {
        version: 1,
        projects: [
          makeProject({ owner: "acme", repo: "api", daemonToken: "token-aaa" }),
          makeProject({ owner: "acme", repo: "ui", daemonToken: "token-bbb" }),
        ],
      };
      cache.read.mockResolvedValue({
        content: JSON.stringify(stored),
        sha: "sha-1",
      });

      const result = await manager.getProjectByToken("token-bbb");

      expect(result).toBeDefined();
      expect(result!.owner).toBe("acme");
      expect(result!.repo).toBe("ui");
    });

    it("returns undefined for unknown token", async () => {
      const { manager } = createMocks();

      const result = await manager.getProjectByToken("nonexistent");

      expect(result).toBeUndefined();
    });
  });

  // ---- updateProjectState ---------------------------------------------------

  describe("updateProjectState()", () => {
    it("applies partial updates and saves", async () => {
      const { manager, cache, client } = createMocks();

      const stored: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "acme", repo: "api" })],
      };
      cache.read.mockResolvedValue({
        content: JSON.stringify(stored),
        sha: "sha-1",
      });

      const result = await manager.updateProjectState("acme", "api", {
        initialized: true,
        workState: "working",
      });

      expect(result).toBeDefined();
      expect(result!.initialized).toBe(true);
      expect(result!.workState).toBe("working");
      expect(client.writeFile).toHaveBeenCalled();
    });

    it("returns undefined for unknown project", async () => {
      const { manager } = createMocks();

      const result = await manager.updateProjectState("acme", "nope", {
        initialized: true,
      });

      expect(result).toBeUndefined();
    });
  });

  describe("getProjectDefaultCopilotAgent()", () => {
    it("returns the stored agent for a project", async () => {
      const { manager, cache } = createMocks();

      const stored: ProjectConfig = {
        version: 1,
        projects: [
          makeProject({
            owner: "acme",
            repo: "api",
            defaultCopilotSdkAgent: "reviewer",
          }),
        ],
      };
      cache.read.mockResolvedValue({
        content: JSON.stringify(stored),
        sha: "sha-1",
      });

      await expect(
        manager.getProjectDefaultCopilotAgent("acme", "api"),
      ).resolves.toBe("reviewer");
    });

    it("returns null when a project uses the default agent", async () => {
      const { manager, cache } = createMocks();

      const stored: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "acme", repo: "api" })],
      };
      cache.read.mockResolvedValue({
        content: JSON.stringify(stored),
        sha: "sha-1",
      });

      await expect(
        manager.getProjectDefaultCopilotAgent("acme", "api"),
      ).resolves.toBeNull();
    });

    it("returns undefined for an unknown project", async () => {
      const { manager } = createMocks();

      await expect(
        manager.getProjectDefaultCopilotAgent("acme", "missing"),
      ).resolves.toBeUndefined();
    });
  });

  describe("updateProjectDefaultCopilotAgent()", () => {
    it("persists a custom agent selection", async () => {
      const { manager, cache } = createMocks();

      const stored: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "acme", repo: "api" })],
      };
      cache.read.mockResolvedValue({
        content: JSON.stringify(stored),
        sha: "sha-1",
      });

      const updated = await manager.updateProjectDefaultCopilotAgent(
        "acme",
        "api",
        "reviewer",
      );

      expect(updated?.defaultCopilotSdkAgent).toBe("reviewer");
    });

    it("persists null when reverting to the default agent", async () => {
      const { manager, cache } = createMocks();

      const stored: ProjectConfig = {
        version: 1,
        projects: [
          makeProject({
            owner: "acme",
            repo: "api",
            defaultCopilotSdkAgent: "reviewer",
          }),
        ],
      };
      cache.read.mockResolvedValue({
        content: JSON.stringify(stored),
        sha: "sha-1",
      });

      const updated = await manager.updateProjectDefaultCopilotAgent(
        "acme",
        "api",
        null,
      );

      expect(updated?.defaultCopilotSdkAgent).toBeNull();
    });
  });

  // ---- getLaunchpadConfig / saveLaunchpadConfig ------------------------------

  describe("getLaunchpadConfig()", () => {
    it("returns defaults when nothing stored", async () => {
      const { manager } = createMocks();

      const config = await manager.getLaunchpadConfig();

      expect(config).toEqual(defaultLaunchpadConfig());
    });

    it("reads from local cache first", async () => {
      const { manager, cache, client } = createMocks();

      const stored: LaunchpadConfig = {
        ...defaultLaunchpadConfig(),
        stateMode: "git",
        stateRepo: "acme/state",
        onboardingComplete: true,
      };
      cache.read.mockResolvedValue({
        content: JSON.stringify(stored),
        sha: "cached-sha",
      });

      const config = await manager.getLaunchpadConfig();

      expect(config.stateMode).toBe("git");
      expect(config.onboardingComplete).toBe(true);
      expect(client.readFile).not.toHaveBeenCalled();
    });
  });

  describe("saveLaunchpadConfig()", () => {
    it("writes to GitHub then updates cache", async () => {
      const { manager, client, cache } = createMocks();

      cache.read.mockResolvedValue({ content: "{}", sha: "old-sha" });

      const config: LaunchpadConfig = {
        ...defaultLaunchpadConfig(),
        onboardingComplete: true,
        copilot: { defaultSessionType: "cli", defaultModel: "gpt-4" },
      };
      await manager.saveLaunchpadConfig(config);

      const expectedContent = JSON.stringify(config, null, 2) + "\n";

      expect(client.writeFile).toHaveBeenCalledWith(
        "launchpad-config.json",
        expectedContent,
        "old-sha",
      );
      expect(cache.write).toHaveBeenCalledWith(
        "launchpad-config.json",
        expectedContent,
        "new-sha-123",
      );
    });
  });
});
