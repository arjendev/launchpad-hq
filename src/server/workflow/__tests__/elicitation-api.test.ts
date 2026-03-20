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

/** Simulate daemon sending an elicitation request */
function emitElicitation(server: FastifyInstance, payload: {
  projectId?: string;
  sessionId?: string;
  elicitationId?: string;
  issueNumber?: number;
  message?: string;
  requestedSchema?: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
} = {}) {
  const registry = server.daemonRegistry as unknown as EventEmitter;
  registry.emit("workflow:elicitation-requested" as never, {
    projectId: payload.projectId ?? "test-owner/test-repo",
    sessionId: payload.sessionId ?? "session-abc",
    elicitationId: payload.elicitationId ?? "elicit-1",
    issueNumber: payload.issueNumber,
    message: payload.message ?? "Which framework?",
    requestedSchema: payload.requestedSchema ?? { type: 'object', properties: {} },
  });
}

describe("Elicitation API", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildTestServer();
    await server.inject({ method: "POST", url: "/api/workflow/test-owner/test-repo/sync" });
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /api/workflow/:owner/:repo/elicitations", () => {
    it("returns empty list when no elicitations exist", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/elicitations",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().elicitations).toEqual([]);
    });

    it("returns pending elicitations for the project", async () => {
      emitElicitation(server, { elicitationId: "e1", message: "Pick one" });
      emitElicitation(server, { elicitationId: "e2", message: "Pick another" });

      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/elicitations",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().elicitations).toHaveLength(2);
    });

    it("does not return elicitations for other projects", async () => {
      emitElicitation(server, { projectId: "other/repo", elicitationId: "e1" });

      const res = await server.inject({
        method: "GET",
        url: "/api/workflow/test-owner/test-repo/elicitations",
      });

      expect(res.json().elicitations).toHaveLength(0);
    });
  });

  describe("POST /api/workflow/:owner/:repo/elicitation/:id/respond", () => {
    it("answers a pending elicitation", async () => {
      emitElicitation(server, { elicitationId: "elicit-1" });

      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/elicitation/elicit-1/respond",
        payload: { response: { choice: "React" } },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.elicitation.status).toBe("answered");
      expect(body.elicitation.response).toEqual({ choice: "React" });
    });

    it("sends response to daemon", async () => {
      emitElicitation(server, { elicitationId: "elicit-1" });

      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/elicitation/elicit-1/respond",
        payload: { response: { choice: "React" } },
      });

      const registry = server.daemonRegistry as unknown as { sendToDaemon: ReturnType<typeof vi.fn> };
      expect(registry.sendToDaemon).toHaveBeenCalledWith(
        "test-owner/test-repo",
        expect.objectContaining({
          type: "workflow:elicitation-response",
          payload: expect.objectContaining({
            elicitationId: "elicit-1",
            response: { choice: "React" },
          }),
        }),
      );
    });

    it("broadcasts answered event to clients", async () => {
      emitElicitation(server, { elicitationId: "elicit-1" });

      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/elicitation/elicit-1/respond",
        payload: { response: { choice: "React" } },
      });

      const ws = server.ws as unknown as { broadcast: ReturnType<typeof vi.fn> };
      const answeredCalls = ws.broadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "workflow" && (c[1] as { type: string }).type === "workflow:elicitation-answered",
      );
      expect(answeredCalls).toHaveLength(1);
    });

    it("returns 404 for unknown elicitation", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/elicitation/nonexistent/respond",
        payload: { response: { v: "test" } },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });

    it("returns 404 for elicitation from different project", async () => {
      emitElicitation(server, { projectId: "other/repo", elicitationId: "e-other" });

      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/elicitation/e-other/respond",
        payload: { response: { v: "test" } },
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 422 for already-answered elicitation", async () => {
      emitElicitation(server, { elicitationId: "elicit-1" });

      await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/elicitation/elicit-1/respond",
        payload: { response: { choice: "React" } },
      });

      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/elicitation/elicit-1/respond",
        payload: { response: { choice: "Vue" } },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe("already_resolved");
    });

    it("returns 400 for missing response", async () => {
      emitElicitation(server, { elicitationId: "elicit-1" });

      const res = await server.inject({
        method: "POST",
        url: "/api/workflow/test-owner/test-repo/elicitation/elicit-1/respond",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("bad_request");
    });
  });
});

describe("Elicitation Integration Flow", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildTestServer();
    await server.inject({ method: "POST", url: "/api/workflow/test-owner/test-repo/sync" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("full elicitation relay: dispatch → elicitation → answer → resume", async () => {
    // 1. Start coordinator and dispatch issue
    await server.inject({
      method: "POST",
      url: "/api/workflow/test-owner/test-repo/coordinator/start",
    });
    activateCoordinator(server);

    await server.inject({
      method: "POST",
      url: "/api/workflow/test-owner/test-repo/dispatch/1",
    });

    // Verify issue is in-progress
    let issuesRes = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/issues",
    });
    let issue = issuesRes.json().issues.find((i: { number: number }) => i.number === 1);
    expect(issue.state).toBe("in-progress");

    // 2. Daemon sends elicitation request
    emitElicitation(server, {
      elicitationId: "elicit-42",
      issueNumber: 1,
      message: "Which testing framework?",
      requestedSchema: { type: 'object', properties: { framework: { type: 'string', enum: ['vitest', 'jest', 'mocha'] } } },
    });

    // Verify issue transitioned to needs-input-blocking
    issuesRes = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/issues",
    });
    issue = issuesRes.json().issues.find((i: { number: number }) => i.number === 1);
    expect(issue.state).toBe("needs-input-blocking");

    // Verify elicitation is listed
    const elicitRes = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/elicitations",
    });
    expect(elicitRes.json().elicitations).toHaveLength(1);
    expect(elicitRes.json().elicitations[0].message).toBe("Which testing framework?");

    // 3. User answers the elicitation
    const respondRes = await server.inject({
      method: "POST",
      url: "/api/workflow/test-owner/test-repo/elicitation/elicit-42/respond",
      payload: { response: { framework: "vitest" } },
    });
    expect(respondRes.statusCode).toBe(200);

    // Verify issue returned to in-progress
    issuesRes = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/issues",
    });
    issue = issuesRes.json().issues.find((i: { number: number }) => i.number === 1);
    expect(issue.state).toBe("in-progress");

    // Verify daemon received the response
    const registry = server.daemonRegistry as unknown as { sendToDaemon: ReturnType<typeof vi.fn> };
    const elicitationResponses = registry.sendToDaemon.mock.calls.filter(
      (c: unknown[]) => (c[1] as { type: string }).type === "workflow:elicitation-response",
    );
    expect(elicitationResponses).toHaveLength(1);
    expect((elicitationResponses[0][1] as { payload: { response: Record<string, unknown> } }).payload.response).toEqual({ framework: "vitest" });

    // Verify elicitation list is now empty (no pending)
    const finalElicit = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/elicitations",
    });
    expect(finalElicit.json().elicitations).toHaveLength(0);
  });

  it("elicitation without issue number does not affect issue state", async () => {
    // Daemon sends elicitation without issueNumber
    emitElicitation(server, {
      elicitationId: "elicit-no-issue",
      message: "General question?",
    });

    // Verify it's stored
    const res = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/elicitations",
    });
    expect(res.json().elicitations).toHaveLength(1);

    // Answer it
    const respondRes = await server.inject({
      method: "POST",
      url: "/api/workflow/test-owner/test-repo/elicitation/elicit-no-issue/respond",
      payload: { response: { answer: "yes" } },
    });
    expect(respondRes.statusCode).toBe(200);
  });

  it("multiple elicitations for different issues", async () => {
    await server.inject({ method: "POST", url: "/api/workflow/test-owner/test-repo/coordinator/start" });
    activateCoordinator(server);

    // Dispatch both issues
    await server.inject({ method: "POST", url: "/api/workflow/test-owner/test-repo/dispatch/1" });
    await server.inject({ method: "POST", url: "/api/workflow/test-owner/test-repo/dispatch/2" });

    // Elicitation for each
    emitElicitation(server, { elicitationId: "e1", issueNumber: 1, message: "Q1?" });
    emitElicitation(server, { elicitationId: "e2", issueNumber: 2, message: "Q2?" });

    // Both issues should be needs-input-blocking
    const issuesRes = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/issues",
    });
    const issues = issuesRes.json().issues;
    expect(issues.find((i: { number: number }) => i.number === 1).state).toBe("needs-input-blocking");
    expect(issues.find((i: { number: number }) => i.number === 2).state).toBe("needs-input-blocking");

    // Answer one — only that issue moves back
    await server.inject({
      method: "POST",
      url: "/api/workflow/test-owner/test-repo/elicitation/e1/respond",
      payload: { response: { answer: "A1" } },
    });

    const issuesRes2 = await server.inject({
      method: "GET",
      url: "/api/workflow/test-owner/test-repo/issues",
    });
    const issues2 = issuesRes2.json().issues;
    expect(issues2.find((i: { number: number }) => i.number === 1).state).toBe("in-progress");
    expect(issues2.find((i: { number: number }) => i.number === 2).state).toBe("needs-input-blocking");
  });

  it("WebSocket events are broadcast through the full relay flow", async () => {
    await server.inject({ method: "POST", url: "/api/workflow/test-owner/test-repo/coordinator/start" });
    activateCoordinator(server);
    await server.inject({ method: "POST", url: "/api/workflow/test-owner/test-repo/dispatch/1" });

    const ws = server.ws as unknown as { broadcast: ReturnType<typeof vi.fn> };
    ws.broadcast.mockClear();

    // Elicitation → should trigger state change broadcast (in-progress → needs-input-blocking)
    emitElicitation(server, { elicitationId: "e1", issueNumber: 1, message: "Q?" });

    const stateChangeCalls = ws.broadcast.mock.calls.filter(
      (c: unknown[]) => c[0] === "workflow" && (c[1] as { type: string }).type === "workflow:issue-state-changed",
    );
    expect(stateChangeCalls.length).toBeGreaterThanOrEqual(1);

    ws.broadcast.mockClear();

    // Answer → should trigger elicitation-answered + state change broadcasts
    await server.inject({
      method: "POST",
      url: "/api/workflow/test-owner/test-repo/elicitation/e1/respond",
      payload: { response: { done: true } },
    });

    const answeredCalls = ws.broadcast.mock.calls.filter(
      (c: unknown[]) => c[0] === "workflow" && (c[1] as { type: string }).type === "workflow:elicitation-answered",
    );
    expect(answeredCalls).toHaveLength(1);

    const resumeCalls = ws.broadcast.mock.calls.filter(
      (c: unknown[]) => c[0] === "workflow" && (c[1] as { type: string }).type === "workflow:issue-state-changed",
    );
    expect(resumeCalls.length).toBeGreaterThanOrEqual(1);
  });
});
