/**
 * Workflow Issue State Machine
 *
 * Manages the lifecycle of GitHub issues through HQ workflow states.
 * Each transition is validated and emits typed events.
 */

// --- Types ---

export type WorkflowState =
  | "backlog"
  | "in-progress"
  | "needs-input-blocking"
  | "needs-input-async"
  | "ready-for-review"
  | "done"
  | "rejected";

export interface WorkflowIssue {
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: WorkflowState;
  githubState: "open" | "closed";
  assignee: string | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  /** When the HQ state was last changed */
  stateChangedAt: string;
  /** Async feedback messages attached to the issue */
  feedback: FeedbackEntry[];
}

export interface FeedbackEntry {
  id: string;
  author: string;
  message: string;
  createdAt: string;
}

export interface StateTransition {
  from: WorkflowState;
  to: WorkflowState;
  issue: { owner: string; repo: string; number: number };
  timestamp: string;
  reason?: string;
}

export type WorkflowEventType =
  | "workflow:issue-state-changed"
  | "workflow:sync-completed";

export interface WorkflowStateChangedEvent {
  type: "workflow:issue-state-changed";
  transition: StateTransition;
  issue: WorkflowIssue;
}

export interface WorkflowSyncCompletedEvent {
  type: "workflow:sync-completed";
  owner: string;
  repo: string;
  issueCount: number;
  timestamp: string;
}

export type WorkflowEvent = WorkflowStateChangedEvent | WorkflowSyncCompletedEvent;

// --- Transition table ---

const VALID_TRANSITIONS: ReadonlyMap<WorkflowState, ReadonlySet<WorkflowState>> = new Map([
  ["backlog", new Set<WorkflowState>(["in-progress", "done", "rejected"])],
  [
    "in-progress",
    new Set<WorkflowState>(["needs-input-blocking", "needs-input-async", "ready-for-review", "done", "rejected"]),
  ],
  ["needs-input-blocking", new Set<WorkflowState>(["in-progress", "done", "rejected"])],
  ["needs-input-async", new Set<WorkflowState>(["in-progress", "done", "rejected"])],
  ["ready-for-review", new Set<WorkflowState>(["done", "in-progress", "rejected"])],
  ["done", new Set<WorkflowState>()],
  ["rejected", new Set<WorkflowState>()],
]);

export const ALL_WORKFLOW_STATES: readonly WorkflowState[] = [
  "backlog",
  "in-progress",
  "needs-input-blocking",
  "needs-input-async",
  "ready-for-review",
  "done",
  "rejected",
];

// --- Validation ---

export function isValidState(state: string): state is WorkflowState {
  return ALL_WORKFLOW_STATES.includes(state as WorkflowState);
}

export function isValidTransition(from: WorkflowState, to: WorkflowState): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed?.has(to) ?? false;
}

export function getValidTransitions(from: WorkflowState): readonly WorkflowState[] {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed ? [...allowed] : [];
}

// --- State machine ---

export type WorkflowEventListener = (event: WorkflowEvent) => void;

export class WorkflowStateMachine {
  private listeners: WorkflowEventListener[] = [];

  on(listener: WorkflowEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: WorkflowEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Attempt to transition an issue to a new state.
   * Returns the updated issue or throws if the transition is invalid.
   */
  transition(issue: WorkflowIssue, to: WorkflowState, reason?: string): WorkflowIssue {
    if (!isValidTransition(issue.state, to)) {
      throw new InvalidTransitionError(issue.state, to, issue.number);
    }

    const now = new Date().toISOString();
    const updated: WorkflowIssue = {
      ...issue,
      state: to,
      stateChangedAt: now,
      updatedAt: now,
    };

    const transition: StateTransition = {
      from: issue.state,
      to,
      issue: { owner: issue.owner, repo: issue.repo, number: issue.number },
      timestamp: now,
      reason,
    };

    this.emit({
      type: "workflow:issue-state-changed",
      transition,
      issue: updated,
    });

    return updated;
  }

  emitSyncCompleted(owner: string, repo: string, issueCount: number): void {
    this.emit({
      type: "workflow:sync-completed",
      owner,
      repo,
      issueCount,
      timestamp: new Date().toISOString(),
    });
  }
}

// --- Errors ---

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: WorkflowState,
    public readonly to: WorkflowState,
    public readonly issueNumber: number,
  ) {
    super(`Invalid transition: ${from} → ${to} for issue #${issueNumber}`);
    this.name = "InvalidTransitionError";
  }
}

// --- Label mapping ---

const STATE_TO_LABEL: Record<WorkflowState, string> = {
  "backlog": "hq:backlog",
  "in-progress": "hq:in-progress",
  "needs-input-blocking": "hq:in-progress",
  "needs-input-async": "hq:in-progress",
  "ready-for-review": "hq:review",
  "done": "hq:done",
  "rejected": "hq:rejected",
};

export function stateToLabel(state: WorkflowState): string {
  return STATE_TO_LABEL[state];
}

const LABEL_TO_STATE: Record<string, WorkflowState> = {
  "hq:backlog": "backlog",
  "hq:in-progress": "in-progress",
  "hq:review": "ready-for-review",
  "hq:done": "done",
  "hq:rejected": "rejected",
};

export function labelToState(label: string): WorkflowState | undefined {
  return LABEL_TO_STATE[label];
}

export const HQ_LABELS = Object.keys(LABEL_TO_STATE);
