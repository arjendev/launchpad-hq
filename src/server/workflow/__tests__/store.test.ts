import { describe, it, expect, beforeEach } from "vitest";
import { WorkflowStore } from "../store.js";
import type { WorkflowIssue, FeedbackEntry } from "../state-machine.js";

function makeIssue(overrides: Partial<WorkflowIssue> = {}): WorkflowIssue {
  return {
    owner: "test-owner",
    repo: "test-repo",
    number: 1,
    title: "Test issue",
    state: "backlog",
    githubState: "open",
    assignee: null,
    labels: [],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    stateChangedAt: "2025-01-01T00:00:00Z",
    feedback: [],
    ...overrides,
  };
}

describe("WorkflowStore", () => {
  let store: WorkflowStore;

  beforeEach(() => {
    // No state service, no flush timer
    store = new WorkflowStore(null, 0);
  });

  it("creates project state on first access", () => {
    const project = store.getProject("owner", "repo");
    expect(project.owner).toBe("owner");
    expect(project.repo).toBe("repo");
    expect(project.issues).toEqual([]);
    expect(project.lastSyncAt).toBeNull();
  });

  it("returns empty issues for unknown project", () => {
    expect(store.getIssues("unknown", "repo")).toEqual([]);
  });

  it("stores and retrieves issues", () => {
    const issues = [makeIssue({ number: 1 }), makeIssue({ number: 2 })];
    store.setIssues("owner", "repo", issues);

    expect(store.getIssues("owner", "repo")).toHaveLength(2);
    expect(store.getIssue("owner", "repo", 1)?.number).toBe(1);
    expect(store.getIssue("owner", "repo", 2)?.number).toBe(2);
  });

  it("returns undefined for unknown issue", () => {
    expect(store.getIssue("owner", "repo", 999)).toBeUndefined();
  });

  it("updates existing issue in place", () => {
    const issues = [makeIssue({ number: 1, state: "backlog" })];
    store.setIssues("owner", "repo", issues);

    const updated = makeIssue({ number: 1, state: "in-progress" });
    store.updateIssue("owner", "repo", updated);

    expect(store.getIssue("owner", "repo", 1)?.state).toBe("in-progress");
    expect(store.getIssues("owner", "repo")).toHaveLength(1);
  });

  it("adds new issue if not found during update", () => {
    store.getProject("owner", "repo"); // ensure project exists
    const issue = makeIssue({ number: 5 });
    store.updateIssue("owner", "repo", issue);

    expect(store.getIssues("owner", "repo")).toHaveLength(1);
    expect(store.getIssue("owner", "repo", 5)?.number).toBe(5);
  });

  it("adds feedback to an issue", () => {
    store.setIssues("owner", "repo", [makeIssue({ number: 1 })]);

    const feedback: FeedbackEntry = {
      id: "fb-1",
      author: "alice",
      message: "Looks good!",
      createdAt: new Date().toISOString(),
    };

    const result = store.addFeedback("owner", "repo", 1, feedback);
    expect(result?.feedback).toHaveLength(1);
    expect(result?.feedback[0].message).toBe("Looks good!");
  });

  it("returns undefined when adding feedback to missing issue", () => {
    const feedback: FeedbackEntry = {
      id: "fb-1",
      author: "alice",
      message: "test",
      createdAt: new Date().toISOString(),
    };

    expect(store.addFeedback("owner", "repo", 999, feedback)).toBeUndefined();
  });

  it("sets lastSyncAt when issues are set", () => {
    store.setIssues("owner", "repo", []);
    const project = store.getProject("owner", "repo");
    expect(project.lastSyncAt).not.toBeNull();
  });

  it("close is safe to call multiple times", async () => {
    await store.close();
    await store.close();
  });
});
