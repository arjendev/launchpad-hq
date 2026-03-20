import { describe, it, expect, beforeEach } from "vitest";
import { computeProjectStatus } from "../../workflow/status-badge.js";
import { ElicitationStore } from "../../workflow/elicitation-store.js";
import type { CoordinatorProjectState } from "../../../shared/protocol.js";
import type { WorkflowIssue } from "../../workflow/state-machine.js";
import { defaultCoordinatorState } from "../../workflow/coordinator-state.js";

function makeIssue(overrides: Partial<WorkflowIssue> = {}): WorkflowIssue {
  return {
    owner: "acme",
    repo: "app",
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

describe("computeProjectStatus", () => {
  let elicitationStore: ElicitationStore;

  beforeEach(() => {
    elicitationStore = new ElicitationStore(0, 0); // no timeouts/cleanup for tests
  });

  it("returns idle when no active issues and coordinator is idle", () => {
    const coord = defaultCoordinatorState();
    const issues: WorkflowIssue[] = [];

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("idle");
    expect(badge.emoji).toBe("🟢");
    expect(badge.label).toBe("Idle");
    expect(badge.activeIssueCount).toBe(0);
  });

  it("returns idle with only backlog issues", () => {
    const coord = defaultCoordinatorState();
    const issues = [makeIssue({ state: "backlog" })];

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("idle");
  });

  it("returns working when issues are in-progress", () => {
    const coord = defaultCoordinatorState();
    const issues = [
      makeIssue({ number: 1, state: "in-progress" }),
      makeIssue({ number: 2, state: "in-progress" }),
    ];

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("working");
    expect(badge.emoji).toBe("🔵");
    expect(badge.activeIssueCount).toBe(2);
  });

  it("returns working when coordinator is active even with no in-progress issues", () => {
    const coord: CoordinatorProjectState = {
      ...defaultCoordinatorState(),
      status: "active",
      sessionId: "test-session",
    };
    const issues: WorkflowIssue[] = [];

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("working");
  });

  it("returns working for needs-input-async issues (work continues)", () => {
    const coord = defaultCoordinatorState();
    const issues = [makeIssue({ state: "needs-input-async" })];

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("working");
  });

  it("returns needs-attention when there are pending elicitations", () => {
    const coord = defaultCoordinatorState();
    const issues: WorkflowIssue[] = [];

    elicitationStore.add({
      id: "e1",
      sessionId: "s1",
      projectId: "acme/app",
      message: "Need input",
      requestedSchema: { type: "object", properties: {} },
    });

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("needs-attention");
    expect(badge.emoji).toBe("🟡");
    expect(badge.details).toContain("elicitation");
  });

  it("returns needs-attention when issues need review", () => {
    const coord = defaultCoordinatorState();
    const issues = [makeIssue({ state: "ready-for-review" })];

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("needs-attention");
    expect(badge.details).toContain("review");
  });

  it("returns needs-attention when issues are blocking", () => {
    const coord = defaultCoordinatorState();
    const issues = [makeIssue({ state: "needs-input-blocking" })];

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("needs-attention");
    expect(badge.details).toContain("blocked");
  });

  it("returns error when coordinator crashed", () => {
    const coord: CoordinatorProjectState = {
      ...defaultCoordinatorState(),
      status: "crashed",
      error: "Out of memory",
    };
    const issues = [makeIssue({ state: "in-progress" })];

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("error");
    expect(badge.emoji).toBe("🔴");
    expect(badge.details).toContain("Out of memory");
  });

  it("error takes priority over needs-attention", () => {
    const coord: CoordinatorProjectState = {
      ...defaultCoordinatorState(),
      status: "crashed",
      error: "crash",
    };
    const issues = [makeIssue({ state: "ready-for-review" })];

    elicitationStore.add({
      id: "e1",
      sessionId: "s1",
      projectId: "acme/app",
      message: "Need input",
      requestedSchema: { type: "object", properties: {} },
    });

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("error");
  });

  it("needs-attention takes priority over working", () => {
    const coord: CoordinatorProjectState = {
      ...defaultCoordinatorState(),
      status: "active",
      sessionId: "s1",
    };
    const issues = [
      makeIssue({ number: 1, state: "in-progress" }),
      makeIssue({ number: 2, state: "ready-for-review" }),
    ];

    const badge = computeProjectStatus("acme", "app", coord, issues, elicitationStore);

    expect(badge.status).toBe("needs-attention");
    expect(badge.activeIssueCount).toBe(1); // the in-progress issue
  });

  it("includes owner and repo in badge", () => {
    const coord = defaultCoordinatorState();
    const badge = computeProjectStatus("org", "my-repo", coord, [], elicitationStore);

    expect(badge.owner).toBe("org");
    expect(badge.repo).toBe("my-repo");
  });
});
