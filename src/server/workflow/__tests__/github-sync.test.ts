import { describe, it, expect, vi, beforeEach } from "vitest";
import { promisify } from "node:util";
import type { WorkflowIssue } from "../state-machine.js";

/**
 * Mock `node:child_process` so that `promisify(execFile)` works correctly.
 * Node's built-in execFile has a custom promisify symbol that returns {stdout, stderr}.
 * We replicate this by attaching `[util.promisify.custom]` on the mock.
 */
const mockResponses = new Map<string, string>();

vi.mock("node:child_process", () => {
  function mockedExecFile(...args: unknown[]) {
    const cb = args[args.length - 1];
    if (typeof cb !== "function") return;
    const cliArgs = args[1] as string[];
    const argsStr = cliArgs.join(" ");
    for (const [keyword, stdout] of mockResponses.entries()) {
      if (argsStr.includes(keyword)) {
        (cb as Function)(null, stdout, "");
        return;
      }
    }
    (cb as Function)(null, "[]", "");
  }

  // Attach custom promisify so `promisify(execFile)` returns {stdout, stderr}
  (mockedExecFile as unknown as Record<symbol, unknown>)[promisify.custom] =
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        mockedExecFile(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });

  return { execFile: mockedExecFile };
});

function setResponse(keyword: string, stdout: string) {
  mockResponses.set(keyword, stdout);
}

function makeGhIssue(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: "Test issue",
    state: "OPEN",
    assignees: [{ login: "alice" }],
    labels: [{ name: "bug" }],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
    ...overrides,
  };
}

function makeTracked(overrides: Partial<WorkflowIssue> = {}): WorkflowIssue {
  return {
    owner: "test-owner",
    repo: "test-repo",
    number: 1,
    title: "Test issue",
    state: "in-progress",
    githubState: "open",
    assignee: "alice",
    labels: ["bug"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    stateChangedAt: "2025-01-01T00:00:00Z",
    feedback: [],
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  let GitHubSyncService: typeof import("../github-sync.js").GitHubSyncService;

  beforeEach(async () => {
    mockResponses.clear();
    const mod = await import("../github-sync.js");
    GitHubSyncService = mod.GitHubSyncService;
  });

  it("fetches and maps new issues to backlog state", async () => {
    const ghIssues = [
      makeGhIssue({ number: 1, title: "First issue" }),
      makeGhIssue({ number: 2, title: "Second issue", state: "CLOSED", assignees: [] }),
    ];
    setResponse("issue list", JSON.stringify(ghIssues));

    const service = new GitHubSyncService("test-token");
    const result = await service.syncIssues("owner", "repo", new Map());

    expect(result.issues).toHaveLength(2);
    expect(result.added).toBe(2);
    expect(result.updated).toBe(0);

    expect(result.issues[0].number).toBe(1);
    expect(result.issues[0].state).toBe("backlog");
    expect(result.issues[0].assignee).toBe("alice");

    expect(result.issues[1].number).toBe(2);
    expect(result.issues[1].githubState).toBe("closed");
    expect(result.issues[1].assignee).toBeNull();
  });

  it("preserves HQ state for existing tracked issues", async () => {
    const ghIssues = [makeGhIssue({ number: 1, title: "Updated title" })];
    setResponse("issue list", JSON.stringify(ghIssues));

    const service = new GitHubSyncService("test-token");
    const existing = new Map<number, WorkflowIssue>();
    existing.set(1, makeTracked({ state: "in-progress", title: "Old title" }));

    const result = await service.syncIssues("owner", "repo", existing);

    expect(result.issues).toHaveLength(1);
    expect(result.updated).toBe(1);
    expect(result.added).toBe(0);
    expect(result.issues[0].state).toBe("in-progress");
    expect(result.issues[0].title).toBe("Updated title");
  });

  it("derives initial state from existing hq: labels", async () => {
    const ghIssues = [
      makeGhIssue({ number: 1, labels: [{ name: "hq:review" }, { name: "bug" }] }),
    ];
    setResponse("issue list", JSON.stringify(ghIssues));

    const service = new GitHubSyncService("test-token");
    const result = await service.syncIssues("owner", "repo", new Map());

    expect(result.issues[0].state).toBe("ready-for-review");
  });

  it("defaults to backlog when no hq: labels exist", async () => {
    const ghIssues = [makeGhIssue({ number: 1, labels: [{ name: "enhancement" }] })];
    setResponse("issue list", JSON.stringify(ghIssues));

    const service = new GitHubSyncService("test-token");
    const result = await service.syncIssues("owner", "repo", new Map());

    expect(result.issues[0].state).toBe("backlog");
  });

  it("handles empty issue list", async () => {
    setResponse("issue list", "[]");

    const service = new GitHubSyncService("test-token");
    const result = await service.syncIssues("owner", "repo", new Map());

    expect(result.issues).toHaveLength(0);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
  });
});
