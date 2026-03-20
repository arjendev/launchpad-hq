import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorkflowStateMachine,
  InvalidTransitionError,
  isValidState,
  isValidTransition,
  getValidTransitions,
  stateToLabel,
  labelToState,
  ALL_WORKFLOW_STATES,
  type WorkflowIssue,
  type WorkflowState,
  type WorkflowEvent,
} from "../state-machine.js";

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

describe("isValidState", () => {
  it("accepts all valid states", () => {
    for (const state of ALL_WORKFLOW_STATES) {
      expect(isValidState(state)).toBe(true);
    }
  });

  it("rejects invalid states", () => {
    expect(isValidState("invalid")).toBe(false);
    expect(isValidState("")).toBe(false);
    expect(isValidState("BACKLOG")).toBe(false);
  });
});

describe("isValidTransition", () => {
  const validTransitions: [WorkflowState, WorkflowState][] = [
    ["backlog", "in-progress"],
    ["in-progress", "needs-input-blocking"],
    ["in-progress", "needs-input-async"],
    ["in-progress", "ready-for-review"],
    ["needs-input-blocking", "in-progress"],
    ["needs-input-async", "in-progress"],
    ["ready-for-review", "done"],
    ["ready-for-review", "in-progress"],
  ];

  for (const [from, to] of validTransitions) {
    it(`allows ${from} → ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(true);
    });
  }

  const invalidTransitions: [WorkflowState, WorkflowState][] = [
    ["backlog", "done"],
    ["backlog", "ready-for-review"],
    ["in-progress", "backlog"],
    ["in-progress", "done"],
    ["done", "backlog"],
    ["done", "in-progress"],
    ["needs-input-blocking", "done"],
    ["needs-input-async", "ready-for-review"],
    ["ready-for-review", "backlog"],
  ];

  for (const [from, to] of invalidTransitions) {
    it(`rejects ${from} → ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  }
});

describe("getValidTransitions", () => {
  it("returns transitions for backlog", () => {
    expect(getValidTransitions("backlog")).toEqual(["in-progress"]);
  });

  it("returns transitions for in-progress", () => {
    const transitions = getValidTransitions("in-progress");
    expect(transitions).toContain("needs-input-blocking");
    expect(transitions).toContain("needs-input-async");
    expect(transitions).toContain("ready-for-review");
  });

  it("returns empty array for done", () => {
    expect(getValidTransitions("done")).toEqual([]);
  });
});

describe("stateToLabel / labelToState", () => {
  it("maps states to labels", () => {
    expect(stateToLabel("backlog")).toBe("hq:backlog");
    expect(stateToLabel("in-progress")).toBe("hq:in-progress");
    expect(stateToLabel("ready-for-review")).toBe("hq:review");
    expect(stateToLabel("done")).toBe("hq:done");
  });

  it("maps labels to states", () => {
    expect(labelToState("hq:backlog")).toBe("backlog");
    expect(labelToState("hq:in-progress")).toBe("in-progress");
    expect(labelToState("hq:review")).toBe("ready-for-review");
    expect(labelToState("hq:done")).toBe("done");
  });

  it("returns undefined for unknown labels", () => {
    expect(labelToState("bug")).toBeUndefined();
    expect(labelToState("hq:unknown")).toBeUndefined();
  });
});

describe("WorkflowStateMachine", () => {
  let sm: WorkflowStateMachine;
  let events: WorkflowEvent[];

  beforeEach(() => {
    sm = new WorkflowStateMachine();
    events = [];
    sm.on((e) => events.push(e));
  });

  it("transitions backlog → in-progress", () => {
    const issue = makeIssue({ state: "backlog" });
    const updated = sm.transition(issue, "in-progress");

    expect(updated.state).toBe("in-progress");
    expect(updated.stateChangedAt).not.toBe(issue.stateChangedAt);
  });

  it("emits state-changed event on transition", () => {
    const issue = makeIssue({ state: "backlog" });
    sm.transition(issue, "in-progress");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("workflow:issue-state-changed");
    const event = events[0] as Extract<WorkflowEvent, { type: "workflow:issue-state-changed" }>;
    expect(event.transition.from).toBe("backlog");
    expect(event.transition.to).toBe("in-progress");
    expect(event.issue.state).toBe("in-progress");
  });

  it("throws InvalidTransitionError on invalid transition", () => {
    const issue = makeIssue({ state: "backlog" });
    expect(() => sm.transition(issue, "done")).toThrow(InvalidTransitionError);
  });

  it("InvalidTransitionError has correct properties", () => {
    const issue = makeIssue({ state: "backlog", number: 42 });
    try {
      sm.transition(issue, "done");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const error = err as InvalidTransitionError;
      expect(error.from).toBe("backlog");
      expect(error.to).toBe("done");
      expect(error.issueNumber).toBe(42);
      expect(error.message).toContain("backlog");
      expect(error.message).toContain("done");
    }
  });

  it("supports full lifecycle: backlog → in-progress → review → done", () => {
    let issue = makeIssue({ state: "backlog" });
    issue = sm.transition(issue, "in-progress");
    issue = sm.transition(issue, "ready-for-review");
    issue = sm.transition(issue, "done");

    expect(issue.state).toBe("done");
    expect(events).toHaveLength(3);
  });

  it("supports request changes: review → in-progress → review → done", () => {
    let issue = makeIssue({ state: "in-progress" });
    issue = sm.transition(issue, "ready-for-review");
    issue = sm.transition(issue, "in-progress"); // request changes
    issue = sm.transition(issue, "ready-for-review");
    issue = sm.transition(issue, "done");

    expect(issue.state).toBe("done");
    expect(events).toHaveLength(4);
  });

  it("includes reason in transition", () => {
    const issue = makeIssue({ state: "in-progress" });
    sm.transition(issue, "needs-input-blocking", "Need API key from team");

    const event = events[0] as Extract<WorkflowEvent, { type: "workflow:issue-state-changed" }>;
    expect(event.transition.reason).toBe("Need API key from team");
  });

  it("emitSyncCompleted sends correct event", () => {
    sm.emitSyncCompleted("owner", "repo", 10);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("workflow:sync-completed");
    const event = events[0] as Extract<WorkflowEvent, { type: "workflow:sync-completed" }>;
    expect(event.owner).toBe("owner");
    expect(event.repo).toBe("repo");
    expect(event.issueCount).toBe(10);
  });

  it("unsubscribe removes listener", () => {
    const unsubscribe = sm.on(() => events.push({ type: "workflow:sync-completed" } as WorkflowEvent));
    unsubscribe();

    const issue = makeIssue({ state: "backlog" });
    sm.transition(issue, "in-progress");

    // Only the original listener should fire
    expect(events).toHaveLength(1);
  });

  it("does not mutate the original issue", () => {
    const issue = makeIssue({ state: "backlog" });
    const original = { ...issue };
    sm.transition(issue, "in-progress");

    expect(issue.state).toBe(original.state);
    expect(issue.stateChangedAt).toBe(original.stateChangedAt);
  });
});
