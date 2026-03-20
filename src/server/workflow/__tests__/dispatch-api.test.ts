import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestServer, type FastifyInstance } from "../../../test-utils/server.js";
import workflowRoutes from "../../routes/workflow.js";
import { EventEmitter } from "node:events";

// Mock the GitHubSyncService
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
    getProjectByToken: vi.fn(),
    updateProjectState: vi.fn(),
    getProjectDefaultCopilotAgent: vi.fn(),
    updateProjectDefaultCopilotAgent: vi.fn(),
    getInbox: vi.fn(),
    saveInbox: vi.fn(),
    sync: vi.fn().mockResolvedValue(undefined),
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

function fakeDaemonRegistry() {
  const registry = Object.assign(new EventEmitter(), {
    getDaemon: vi.fn().mockReturnValue({ daemonId: "test-owner/test-repo", ws: {} }),
    sendToDaemon: vi.fn().mockReturnValue(true),
    getAllDaemons: vi.fn().mockReturnValue([]),
  });
  return registry;
}

async function buildTestServer(): Promise<FastifyInstance> {
  const server = await createTestServer();
  server.decorate("githubToken", "mock-gh-token");
  server.decorate("stateService", fakeStateService());
  server.decorate("ws", fakeWs());
  server.decorate("daemonRegistry", fakeDaemonRegistry());
  await server.register(workflowRoutes);
  return server;
}

/** Simulate the daemon reporting coordinator-started to activate coordinator */
function activateCoordinator(server: FastifyInstance) {
  const registry = server.daemonRegistry as unknown as EventEmitter;
  registry.emit("workflow:coordinator-started" as never, {
    projectId: "test-owner/test-repo",
    sessionId: "session-abc",
  });
}

describe("Dispatch API", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildTestServer();
    // Sync to populate issues
    await server.inject({ method: "POST", url: "/api/workflow/test-owner/test-repo/sync" });
  });

  afterEach(async () => {
    await server.close();
  });

  describe("POST /api/workflow/:owner/:repo/coordinator/start", () => {
    it("starts coordinator when daemon is connected", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/start",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.coordinator.status).toBe("starting");
    });

    it("sends start message to daemon", async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/start",
      });

      const registry = server.daemonRegistry as unknown as { sendToDaemon: ReturnType<typeof vi.fn> };
      expect(registry.sendToDaemon).toHaveBeenCalledWith(
        "test-owner/test-repo",
        expect.objectContaining({ type: "workflow:start-coordinator" }),
      );
    });

    it("returns 503 if daemon is offline", async () => {
      const registry = server.daemonRegistry as unknown as { getDaemon: ReturnType<typeof vi.fn> };
      registry.getDaemon.mockReturnValue(undefined);

      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/start",
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe("daemon_offline");
    });

    it("returns current status if already active", async () => {
      // Start coordinator and simulate daemon started event
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/start",
      });
      activateCoordinator(server);

      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/start",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().coordinator.status).toBe("active");
    });

    it("broadcasts coordinator status change via WebSocket", async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/start",
      });

      const ws = server.ws as unknown as { broadcast: ReturnType<typeof vi.fn> };
      const statusCalls = ws.broadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "workflow" && (c[1] as { type: string }).type === "workflow:coordinator-status-changed",
      );
      expect(statusCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("POST /api/workflow/:owner/:repo/coordinator/stop", () => {
    it("stops coordinator and resets to idle", async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/start",
      });
      activateCoordinator(server);

      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/stop",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().coordinator.status).toBe("idle");
    });

    it("is idempotent for already-idle coordinator", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/stop",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().coordinator.status).toBe("idle");
    });
  });

  describe("GET /api/workflow/:owner/:repo/coordinator/status", () => {
    it("returns default idle coordinator status", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/coordinator/status",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().coordinator.status).toBe("idle");
    });

    it("returns active status after coordinator started", async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/start",
      });
      activateCoordinator(server);

      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/coordinator/status",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().coordinator.status).toBe("active");
      expect(res.json().coordinator.sessionId).toBe("session-abc");
    });
  });

  describe("POST /api/workflow/:owner/:repo/dispatch/:issueNumber", () => {
    beforeEach(async () => {
      // Start coordinator and activate
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/start",
      });
      activateCoordinator(server);
    });

    it("dispatches a backlog issue", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/dispatch/1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(res.json().status).toBe("dispatched");
    });

    it("transitions issue to in-progress", async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/dispatch/1",
      });

      // Verify via GET issues
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/issues",
      });
      const issue = res.json().issues.find((i: { number: number }) => i.number === 1);
      expect(issue.state).toBe("in-progress");
    });

    it("sends dispatch message to daemon", async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/dispatch/1",
      });

      const registry = server.daemonRegistry as unknown as { sendToDaemon: ReturnType<typeof vi.fn> };
      expect(registry.sendToDaemon).toHaveBeenCalledWith(
        "test-owner/test-repo",
        expect.objectContaining({ type: "workflow:dispatch-issue" }),
      );
    });

    it("rejects dispatch for non-backlog issue", async () => {
      // First dispatch moves to in-progress
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/dispatch/1",
      });

      // Second dispatch fails
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/dispatch/1",
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe("invalid_state");
    });

    it("rejects dispatch when coordinator is not active", async () => {
      // Stop the coordinator
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/coordinator/stop",
      });

      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/dispatch/1",
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe("coordinator_not_active");
    });

    it("returns 404 for unknown issue", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/dispatch/999",
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid issue number", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/dispatch/abc",
      });

      expect(res.statusCode).toBe(400);
    });

    it("broadcasts dispatch-started via WebSocket", async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/dispatch/1",
      });

      const ws = server.ws as unknown as { broadcast: ReturnType<typeof vi.fn> };
      const dispatchCalls = ws.broadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "workflow" && (c[1] as { type: string }).type === "workflow:dispatch-started",
      );
      expect(dispatchCalls).toHaveLength(1);
    });

    it("records dispatch in coordinator status", async () => {
      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/dispatch/1",
      });

      const statusRes = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/coordinator/status",
      });
      const coord = statusRes.json().coordinator;
      expect(coord.dispatches).toHaveLength(1);
      expect(coord.dispatches[0].issueNumber).toBe(1);
    });
  });

  describe("GET /api/workflow/:owner/:repo/issues/:number/commits", () => {
    it("returns empty commits for issue with no tracked commits", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/issues/1/commits",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().commits).toEqual([]);
    });

    it("returns 400 for invalid issue number", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/issues/abc/commits",
      });

      expect(res.statusCode).toBe(400);
    });
  });
});

describe("Dispatch Integration Flow", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildTestServer();
    await server.inject({ method: "POST", url: "/api/workflow/test-owner/test-repo/sync" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("full dispatch lifecycle: start → dispatch → progress → complete", async () => {
    // 1. Start coordinator
    const startRes = await server.inject({
      method: "POST",
      url: "/api/workflow/test-owner/test-repo/coordinator/start",
    });
    expect(startRes.statusCode).toBe(200);

    // 2. Simulate coordinator-started event from daemon
    activateCoordinator(server);

    // Verify coordinator is active
    const statusRes = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/coordinator/status",
    });
    expect(statusRes.json().coordinator.status).toBe("active");

    // 3. Dispatch issue
    const dispatchRes = await server.inject({
      method: "POST",
      url: "/api/workflow/test-owner/test-repo/dispatch/1",
    });
    expect(dispatchRes.statusCode).toBe(200);

    // Verify issue in-progress
    const issuesRes1 = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/issues",
    });
    const issue1 = issuesRes1.json().issues.find((i: { number: number }) => i.number === 1);
    expect(issue1.state).toBe("in-progress");

    // 4. Simulate progress with commits via daemon event listener
    const registry = server.daemonRegistry as unknown as EventEmitter;
    registry.emit("workflow:progress" as never, {
      projectId: "test-owner/test-repo",
      issueNumber: 1,
      message: "Implementing feature",
      commits: [{ sha: "abc123", message: "feat: add widget (#1)", author: "bot" }],
    });

    // 5. Simulate issue-completed event from daemon
    registry.emit("workflow:issue-completed" as never, {
      projectId: "test-owner/test-repo",
      issueNumber: 1,
      summary: "Widget feature complete",
      commits: [{ sha: "def456", message: "test: add widget tests (#1)" }],
    });

    // Verify issue transitioned to ready-for-review
    const issuesRes2 = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/issues",
    });
    const issue2 = issuesRes2.json().issues.find((i: { number: number }) => i.number === 1);
    expect(issue2.state).toBe("ready-for-review");

    // Verify dispatch record completed
    const coordRes = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/coordinator/status",
    });
    const dispatch = coordRes.json().coordinator.dispatches.find(
      (d: { issueNumber: number }) => d.issueNumber === 1,
    );
    expect(dispatch.status).toBe("completed");

    // Verify commits tracked and available via API
    const commitsRes = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/issues/1/commits",
    });
    expect(commitsRes.json().commits).toHaveLength(2);
  });

  it("handles coordinator crash", async () => {
    // Start and activate
    await server.inject({
      method: "POST",
      url: "/api/workflow/test-owner/test-repo/coordinator/start",
    });
    activateCoordinator(server);

    // Simulate crash
    const registry = server.daemonRegistry as unknown as EventEmitter;
    registry.emit("workflow:coordinator-crashed" as never, {
      projectId: "test-owner/test-repo",
      error: "Process killed",
    });

    // Verify status
    const res = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/coordinator/status",
    });
    expect(res.json().coordinator.status).toBe("crashed");
    expect(res.json().coordinator.error).toBe("Process killed");
  });

  it("handles health ping updates", async () => {
    await server.inject({
      method: "POST",
      url: "/api/workflow/test-owner/test-repo/coordinator/start",
    });
    activateCoordinator(server);

    const registry = server.daemonRegistry as unknown as EventEmitter;
    registry.emit("workflow:coordinator-health" as never, {
      projectId: "test-owner/test-repo",
      sessionId: "session-abc",
    });

    const res = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/coordinator/status",
    });
    expect(res.json().coordinator.lastSeenAt).toBeTruthy();
  });
});
