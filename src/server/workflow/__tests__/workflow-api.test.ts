import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestServer, type FastifyInstance } from "../../../test-utils/server.js";
import workflowRoutes from "../../routes/workflow.js";

// Mock the GitHubSyncService used inside the route
vi.mock("../../workflow/github-sync.js", () => {
  const mockIssues = [
    {
      number: 1,
      title: "First issue",
      state: "OPEN",
      assignees: [{ login: "alice" }],
      labels: [{ name: "bug" }],
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
    },
    {
      number: 2,
      title: "Second issue",
      state: "OPEN",
      assignees: [],
      labels: [],
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-03T00:00:00Z",
    },
  ];

  class MockGitHubSyncService {
    async syncIssues(owner: string, repo: string, existing: Map<number, unknown>) {
      const issues = mockIssues.map((gh) => {
        if (existing.has(gh.number)) {
          const tracked = existing.get(gh.number) as Record<string, unknown>;
          return { ...tracked, title: gh.title, updatedAt: gh.updatedAt };
        }
        return {
          owner,
          repo,
          number: gh.number,
          title: gh.title,
          state: "backlog",
          githubState: gh.state === "OPEN" ? "open" : "closed",
          assignee: gh.assignees[0]?.login ?? null,
          labels: gh.labels.map((l: { name: string }) => l.name),
          createdAt: gh.createdAt,
          updatedAt: gh.updatedAt,
          stateChangedAt: new Date().toISOString(),
          feedback: [],
        };
      });
      return {
        issues,
        added: issues.filter((_: unknown, i: number) => !existing.has(mockIssues[i].number)).length,
        updated: issues.filter((_: unknown, i: number) => existing.has(mockIssues[i].number)).length,
        errors: [],
      };
    }

    async syncLabelToGitHub() {}
    async postTransitionComment() {}
    async postFeedbackComment() {}
    async closeIssue() {}
    async createIssue() { return { number: 99, title: "New issue" }; }
    async getIssueComments() { return [{ author: "alice", body: "A comment", createdAt: "2025-01-01T00:00:00Z" }]; }
    async editIssue() {}
  }

  return { GitHubSyncService: MockGitHubSyncService };
});

// Minimal fake stateService
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
    getInbox: vi.fn(),
    saveInbox: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

// Minimal fake ws decorator
function fakeWs() {
  return {
    broadcast: vi.fn(),
    sendToClient: vi.fn(),
    clients: () => 0,
  };
}

async function buildTestServer(): Promise<FastifyInstance> {
  const server = await createTestServer();

  // Decorate with required dependencies
  server.decorate("githubToken", "mock-gh-token");
  server.decorate("stateService", fakeStateService());
  server.decorate("ws", fakeWs());

  await server.register(workflowRoutes);
  return server;
}

describe("Workflow API", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /api/workflow/:owner/:repo/issues", () => {
    it("returns empty list when no issues are tracked", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/issues",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().issues).toEqual([]);
    });

    it("returns issues after sync", async () => {
      // First sync
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/sync",
      });

      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/issues",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().issues).toHaveLength(2);
    });
  });

  describe("POST /api/workflow/:owner/:repo/sync", () => {
    it("syncs issues from GitHub", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/sync",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.issueCount).toBe(2);
      expect(body.added).toBe(2);
    });

    it("broadcasts sync completed event via WebSocket", async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/sync",
      });

      const ws = server.ws as unknown as { broadcast: ReturnType<typeof vi.fn> };
      expect(ws.broadcast).toHaveBeenCalledWith(
        "workflow",
        expect.objectContaining({ type: "workflow:sync-completed" }),
      );
    });
  });

  describe("PUT /api/workflow/:owner/:repo/issues/:number/state", () => {
    beforeEach(async () => {
      // Sync first to populate issues
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/sync",
      });
    });

    it("transitions issue state", async () => {
      const res = await server.inject({
        method: "PUT",
        url: "/api/workflow/test-owner/test-repo/issues/1/state",
        payload: { state: "in-progress" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.issue.state).toBe("in-progress");
    });

    it("broadcasts state change via WebSocket", async () => {
      await server.inject({
        method: "PUT",
        url: "/api/workflow/test-owner/test-repo/issues/1/state",
        payload: { state: "in-progress" },
      });

      const ws = server.ws as unknown as { broadcast: ReturnType<typeof vi.fn> };
      const workflowCalls = ws.broadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "workflow" && (c[1] as { type: string }).type === "workflow:issue-state-changed",
      );
      expect(workflowCalls).toHaveLength(1);
    });

    it("rejects invalid state", async () => {
      const res = await server.inject({
        method: "PUT",
        url: "/api/workflow/test-owner/test-repo/issues/1/state",
        payload: { state: "invalid-state" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("bad_request");
    });

    it("rejects invalid transition", async () => {
      const res = await server.inject({
        method: "PUT",
        url: "/api/workflow/test-owner/test-repo/issues/1/state",
        payload: { state: "ready-for-review" },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe("invalid_transition");
    });

    it("returns 404 for unknown issue", async () => {
      const res = await server.inject({
        method: "PUT",
        url: "/api/workflow/test-owner/test-repo/issues/999/state",
        payload: { state: "in-progress" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("rejects invalid issue number", async () => {
      const res = await server.inject({
        method: "PUT",
        url: "/api/workflow/test-owner/test-repo/issues/abc/state",
        payload: { state: "in-progress" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/workflow/:owner/:repo/issues/:number/feedback", () => {
    beforeEach(async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/sync",
      });
    });

    it("adds feedback to an issue", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/issues/1/feedback",
        payload: { message: "Great progress!", author: "bob" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.feedback.message).toBe("Great progress!");
      expect(body.feedback.author).toBe("bob");
      expect(body.issue.feedback).toHaveLength(1);
    });

    it("uses anonymous author if not provided", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/issues/1/feedback",
        payload: { message: "Test feedback" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().feedback.author).toBe("anonymous");
    });

    it("rejects empty message", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/issues/1/feedback",
        payload: { message: "" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for unknown issue", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/issues/999/feedback",
        payload: { message: "test" },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("PUT /api/workflow/:owner/:repo/issues/:number/state — rejected", () => {
    beforeEach(async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/sync",
      });
    });

    it("transitions issue to rejected", async () => {
      const res = await server.inject({
        method: "PUT",
        url: "/api/workflow/test-owner/test-repo/issues/1/state",
        payload: { state: "rejected", reason: "Won't implement" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().issue.state).toBe("rejected");
    });

    it("transitions issue to done from backlog", async () => {
      const res = await server.inject({
        method: "PUT",
        url: "/api/workflow/test-owner/test-repo/issues/1/state",
        payload: { state: "done" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().issue.state).toBe("done");
    });

    it("includes rejected in valid states error message", async () => {
      const res = await server.inject({
        method: "PUT",
        url: "/api/workflow/test-owner/test-repo/issues/1/state",
        payload: { state: "invalid-state" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("rejected");
    });
  });

  describe("GET /api/workflow/:owner/:repo/issues/:number/comments", () => {
    it("returns comments for an issue", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/issues/1/comments",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.comments).toHaveLength(1);
      expect(body.comments[0].author).toBe("alice");
      expect(body.comments[0].body).toBe("A comment");
    });

    it("rejects invalid issue number", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/issues/abc/comments",
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
