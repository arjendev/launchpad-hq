import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalStateManager } from "../local-state-manager.js";
import type {
  ProjectConfig,
  ProjectEntry,
  EnrichmentData,
  UserPreferences,
} from "../types.js";

function makeProject(
  overrides: Partial<ProjectEntry> & Pick<ProjectEntry, "owner" | "repo">,
): ProjectEntry {
  return {
    addedAt: "2026-01-01T00:00:00Z",
    runtimeTarget: "local",
    initialized: false,
    daemonToken: "test-token-" + overrides.owner + "-" + overrides.repo,
    workState: "stopped",
    ...overrides,
  };
}

describe("LocalStateManager", () => {
  let root: string;
  let manager: LocalStateManager;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "launchpad-local-test-"));
    manager = new LocalStateManager({ root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ---- sync -----------------------------------------------------------------

  describe("sync()", () => {
    it("creates the state directory", async () => {
      const { existsSync } = await import("node:fs");
      rmSync(root, { recursive: true, force: true });
      expect(existsSync(root)).toBe(false);

      await manager.sync();

      expect(existsSync(root)).toBe(true);
    });
  });

  // ---- getConfig / saveConfig ------------------------------------------------

  describe("getConfig()", () => {
    it("returns default config when nothing exists", async () => {
      const config = await manager.getConfig();
      expect(config).toEqual({ version: 1, projects: [] });
    });

    it("returns saved config after write", async () => {
      const config: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "acme", repo: "widget" })],
      };

      await manager.saveConfig(config);
      const loaded = await manager.getConfig();

      expect(loaded).toEqual(config);
    });
  });

  // ---- getPreferences / savePreferences --------------------------------------

  describe("getPreferences()", () => {
    it("returns defaults when nothing stored", async () => {
      const prefs = await manager.getPreferences();
      expect(prefs).toEqual({ version: 1, theme: "system" });
    });
  });

  describe("savePreferences()", () => {
    it("round-trips preferences", async () => {
      const prefs: UserPreferences = { version: 1, theme: "dark" };
      await manager.savePreferences(prefs);
      const loaded = await manager.getPreferences();
      expect(loaded).toEqual(prefs);
    });
  });

  // ---- getEnrichment / saveEnrichment ----------------------------------------

  describe("getEnrichment()", () => {
    it("returns defaults when nothing stored", async () => {
      const enrichment = await manager.getEnrichment();
      expect(enrichment.version).toBe(1);
      expect(enrichment.projects).toEqual({});
    });
  });

  describe("saveEnrichment()", () => {
    it("stamps updatedAt and persists", async () => {
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
      const loaded = await manager.getEnrichment();

      expect(loaded.updatedAt).not.toBe("old");
      expect(loaded.projects["acme/api"].devcontainerStatus).toBe("active");
    });
  });

  // ---- getProjectByToken ----------------------------------------------------

  describe("getProjectByToken()", () => {
    it("returns the matching project", async () => {
      const config: ProjectConfig = {
        version: 1,
        projects: [
          makeProject({ owner: "acme", repo: "api", daemonToken: "token-aaa" }),
          makeProject({ owner: "acme", repo: "ui", daemonToken: "token-bbb" }),
        ],
      };
      await manager.saveConfig(config);

      const result = await manager.getProjectByToken("token-bbb");

      expect(result).toBeDefined();
      expect(result!.owner).toBe("acme");
      expect(result!.repo).toBe("ui");
    });

    it("returns undefined for unknown token", async () => {
      const result = await manager.getProjectByToken("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  // ---- updateProjectState ---------------------------------------------------

  describe("updateProjectState()", () => {
    it("applies partial updates and persists", async () => {
      const config: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "acme", repo: "api" })],
      };
      await manager.saveConfig(config);

      const result = await manager.updateProjectState("acme", "api", {
        initialized: true,
        workState: "working",
      });

      expect(result).toBeDefined();
      expect(result!.initialized).toBe(true);
      expect(result!.workState).toBe("working");

      // Verify persistence
      const loaded = await manager.getConfig();
      expect(loaded.projects[0].initialized).toBe(true);
    });

    it("returns undefined for unknown project", async () => {
      const result = await manager.updateProjectState("acme", "nope", {
        initialized: true,
      });
      expect(result).toBeUndefined();
    });

    it("matches project case-insensitively", async () => {
      const config: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "Acme", repo: "API" })],
      };
      await manager.saveConfig(config);

      const result = await manager.updateProjectState("acme", "api", {
        initialized: true,
      });

      expect(result).toBeDefined();
      expect(result!.initialized).toBe(true);
    });
  });

  // ---- getProjectDefaultCopilotAgent ----------------------------------------

  describe("getProjectDefaultCopilotAgent()", () => {
    it("returns the stored agent for a project", async () => {
      const config: ProjectConfig = {
        version: 1,
        projects: [
          makeProject({
            owner: "acme",
            repo: "api",
            defaultCopilotSdkAgent: "reviewer",
          }),
        ],
      };
      await manager.saveConfig(config);

      await expect(
        manager.getProjectDefaultCopilotAgent("acme", "api"),
      ).resolves.toBe("reviewer");
    });

    it("returns null when a project uses the default agent", async () => {
      const config: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "acme", repo: "api" })],
      };
      await manager.saveConfig(config);

      await expect(
        manager.getProjectDefaultCopilotAgent("acme", "api"),
      ).resolves.toBeNull();
    });

    it("returns undefined for an unknown project", async () => {
      await expect(
        manager.getProjectDefaultCopilotAgent("acme", "missing"),
      ).resolves.toBeUndefined();
    });
  });

  // ---- updateProjectDefaultCopilotAgent -------------------------------------

  describe("updateProjectDefaultCopilotAgent()", () => {
    it("persists a custom agent selection", async () => {
      const config: ProjectConfig = {
        version: 1,
        projects: [makeProject({ owner: "acme", repo: "api" })],
      };
      await manager.saveConfig(config);

      const updated = await manager.updateProjectDefaultCopilotAgent(
        "acme",
        "api",
        "reviewer",
      );

      expect(updated?.defaultCopilotSdkAgent).toBe("reviewer");
    });

    it("persists null when reverting to the default agent", async () => {
      const config: ProjectConfig = {
        version: 1,
        projects: [
          makeProject({
            owner: "acme",
            repo: "api",
            defaultCopilotSdkAgent: "reviewer",
          }),
        ],
      };
      await manager.saveConfig(config);

      const updated = await manager.updateProjectDefaultCopilotAgent(
        "acme",
        "api",
        null,
      );

      expect(updated?.defaultCopilotSdkAgent).toBeNull();
    });
  });

  // ---- inbox ----------------------------------------------------------------

  describe("inbox", () => {
    it("returns default inbox when nothing stored", async () => {
      const inbox = await manager.getInbox("acme", "api");
      expect(inbox).toEqual({
        version: 1,
        projectId: "acme/api",
        messages: [],
      });
    });

    it("round-trips inbox data", async () => {
      const inbox = {
        version: 1 as const,
        projectId: "acme/api",
        messages: [
          {
            id: "msg-1",
            projectId: "acme/api",
            sessionId: "sess-1",
            tool: "report_blocker" as const,
            args: { reason: "test" },
            title: "Test blocker",
            status: "unread" as const,
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      };

      await manager.saveInbox("acme", "api", inbox);
      const loaded = await manager.getInbox("acme", "api");

      expect(loaded).toEqual(inbox);
    });
  });
});
