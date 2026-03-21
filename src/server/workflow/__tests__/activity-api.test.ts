import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestServer, type FastifyInstance } from "../../../test-utils/server.js";
import workflowPlugin from "../plugin.js";
import workflowRoutes from "../../routes/workflow.js";
import { ActivityStore } from "../../workflow/activity-store.js";

// Mock the GitHubSyncService
vi.mock("../../workflow/github-sync.js", () => {
  class MockGitHubSyncService {
    async syncIssues(owner: string, repo: string, existing: Map<number, unknown>) {
      const issues = [
        {
          owner,
          repo,
          number: 1,
          title: "Test issue",
          state: "backlog",
          githubState: "open",
          assignee: null,
          labels: [],
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-02T00:00:00Z",
          stateChangedAt: new Date().toISOString(),
          feedback: [],
        },
        {
          owner,
          repo,
          number: 2,
          title: "Second issue",
          state: "backlog",
          githubState: "open",
          assignee: null,
          labels: [],
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-03T00:00:00Z",
          stateChangedAt: new Date().toISOString(),
          feedback: [],
        },
      ];
      return { issues, added: 2, updated: 0, errors: [] };
    }
    async syncLabelToGitHub() {}
    async postTransitionComment() {}
    async postFeedbackComment() {}
    async closeIssue() {}
    async createIssue() { return { number: 99, title: "New issue" }; }
    async getIssueComments() { return []; }
    async editIssue() {}
  }
  return { GitHubSyncService: MockGitHubSyncService };
});

function fakeStateService() {
  return {
    getEnrichment: vi.fn().mockResolvedValue({ version: 1, projects: {}, updatedAt: new Date().toISOString() }),
    saveEnrichment: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue({ version: 1, projects: [] }),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    getPreferences: vi.fn().mockResolvedValue({ version: 1, theme: "system" }),
    savePreferences: vi.fn().mockResolvedValue(undefined),
    getLaunchpadConfig: vi.fn(),
    saveLaunchpadConfig: vi.fn(),
    sync: vi.fn().mockResolvedValue(undefined),
    getProjectByToken: vi.fn(),
    updateProjectState: vi.fn(),
    getProjectDefaultCopilotAgent: vi.fn(),
    updateProjectDefaultCopilotAgent: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeWs() {
  return {
    broadcast: vi.fn(),
    sendToClient: vi.fn(),
    clients: () => 0,
  };
}

// Shared activity store injected before plugin registration
let sharedActivityStore: ActivityStore;

async function buildTestServer(): Promise<FastifyInstance> {
  const server = await createTestServer();
  server.decorate("githubToken", "mock-gh-token");
  server.decorate("stateService", fakeStateService());
  server.decorate("ws", fakeWs());

  // Pre-decorate with activity store so the plugin picks it up.
  // The workflow plugin will overwrite with its own, but we can
  // seed events via inject routes instead.
  sharedActivityStore = new ActivityStore();

  await server.register(workflowPlugin);
  await server.register(workflowRoutes);
  return server;
}

describe("Activity Feed API", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /api/workflow/activity", () => {
    it("returns empty feed initially", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/activity",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.hasMore).toBe(false);
    });
  });

  describe("GET /api/workflow/:owner/:repo/activity", () => {
    it("returns empty for unknown project", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/unknown/repo/activity",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events).toEqual([]);
    });
  });

  describe("GET /api/workflow/:owner/:repo/status", () => {
    it("returns idle status for empty project", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/acme/app/status",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("idle");
      expect(body.emoji).toBe("🟢");
      expect(body.owner).toBe("acme");
      expect(body.repo).toBe("app");
    });

    it("returns working status when issues are in-progress", async () => {
      // Sync to populate issues
      await server.inject({ method: "POST", url: "/api/workflow/acme/app/sync" });

      // Transition issue #1 to in-progress
      await server.inject({
        method: "PUT",
        url: "/api/workflow/acme/app/issues/1/state",
        payload: { state: "in-progress", reason: "test" },
      });

      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/acme/app/status",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("working");
      expect(body.emoji).toBe("🔵");
      expect(body.activeIssueCount).toBe(1);
    });
  });

  describe("GET /api/workflow/status", () => {
    it("returns all project statuses", async () => {
      // Sync two projects
      await server.inject({ method: "POST", url: "/api/workflow/acme/app/sync" });
      await server.inject({ method: "POST", url: "/api/workflow/acme/other/sync" });

      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/status",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.projects).toHaveLength(2);
      expect(body.projects.every((p: { status: string }) => p.status === "idle")).toBe(true);
    });

    it("returns empty when no projects", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/status",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().projects).toEqual([]);
    });
  });

  describe("activity query params", () => {
    it("supports limit param on global activity", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/activity?limit=5",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toEqual([]);
      expect(body.hasMore).toBe(false);
    });

    it("supports types filter on global activity", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/activity?types=coordinator-started,coordinator-crashed",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events).toEqual([]);
    });

    it("supports since filter on global activity", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/activity?since=2025-01-01T00:00:00Z",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events).toEqual([]);
    });

    it("supports query params on project activity", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/acme/app/activity?limit=10&types=progress&since=2025-01-01T00:00:00Z",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events).toEqual([]);
    });
  });
});
