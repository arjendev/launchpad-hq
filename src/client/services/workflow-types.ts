/**
 * Workflow types — matches the backend workflow API contracts.
 * Romilly's backend serves these via /api/workflow/:owner/:repo/*
 */

// ── Workflow states ─────────────────────────────────────

export type WorkflowState =
  | "backlog"
  | "in-progress"
  | "needs-input-blocking"
  | "needs-input-async"
  | "ready-for-review"
  | "done"
  | "rejected";

export const WORKFLOW_STATES: readonly WorkflowState[] = [
  "backlog",
  "in-progress",
  "needs-input-blocking",
  "needs-input-async",
  "ready-for-review",
  "done",
  "rejected",
] as const;

// ── Status display config ───────────────────────────────

export interface WorkflowStateConfig {
  label: string;
  color: string;
  emoji: string;
}

export const WORKFLOW_STATE_CONFIG: Record<WorkflowState, WorkflowStateConfig> = {
  "backlog":              { label: "Backlog",        color: "gray",   emoji: "⚪" },
  "in-progress":          { label: "In Progress",    color: "blue",   emoji: "🔵" },
  "needs-input-blocking": { label: "Needs Input",    color: "yellow", emoji: "🟡" },
  "needs-input-async":    { label: "Needs Input",    color: "yellow", emoji: "🟡" },
  "ready-for-review":     { label: "Review",         color: "green",  emoji: "🟢" },
  "done":                 { label: "Done",           color: "teal",   emoji: "✅" },
  "rejected":             { label: "Rejected",       color: "red",    emoji: "🚫" },
};

// Sort priority (lower = earlier in list)
export const WORKFLOW_STATE_SORT: Record<WorkflowState, number> = {
  "ready-for-review":     0,
  "needs-input-blocking": 1,
  "needs-input-async":    2,
  "in-progress":          3,
  "backlog":              4,
  "done":                 5,
  "rejected":             6,
};

// ── Issue type ──────────────────────────────────────────

export interface WorkflowIssue {
  number: number;
  title: string;
  state: WorkflowState;
  project: string;
  labels: Array<{ name: string; color: string }>;
  createdAt: string;
  updatedAt: string;
  ghUrl: string;
}

export interface WorkflowIssuesResponse {
  issues: WorkflowIssue[];
  count: number;
}

export interface WorkflowSyncResponse {
  synced: number;
  message: string;
}

export interface WorkflowTransitionResponse {
  issue: WorkflowIssue;
}

// ── Elicitation types ───────────────────────────────────

export type ElicitationStatus = "pending" | "answered" | "timeout";

export interface WorkflowElicitation {
  id: string;
  question: string;
  options: string[] | null;
  issueNumber: number;
  timestamp: string;
  status: ElicitationStatus;
}

export interface ElicitationListResponse {
  elicitations: WorkflowElicitation[];
}

export interface ElicitationRespondRequest {
  response: string;
}

export interface ElicitationRespondResponse {
  elicitation: WorkflowElicitation;
}

// ── Activity feed types ─────────────────────────────────

export type ActivityEventType =
  | "issue-dispatched"
  | "progress"
  | "elicitation-requested"
  | "elicitation-answered"
  | "elicitation-timeout"
  | "issue-completed"
  | "coordinator-started"
  | "coordinator-crashed"
  | "review-approved"
  | "review-rejected";

export type ActivitySeverity = "info" | "warning" | "urgent";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: ActivityEventType;
  projectOwner: string;
  projectRepo: string;
  issueNumber?: number;
  message: string;
  severity: ActivitySeverity;
}

export interface ActivityQuery {
  since?: string;
  limit?: number;
  types?: ActivityEventType[];
}

export interface PaginatedActivityResult {
  events: ActivityEvent[];
  total: number;
  hasMore: boolean;
}

export interface WorkflowActivityEvent {
  type: "workflow:activity";
  event: ActivityEvent;
}

// ── Coordinator status types ────────────────────────────

export type CoordinatorStatus = "idle" | "starting" | "active" | "crashed";

export interface CoordinatorState {
  status: CoordinatorStatus;
  sessionId?: string | null;
  startedAt?: string;
  lastHealthPing?: string;
  activeDispatches: Array<{
    issueNumber: number;
    status: "pending" | "running" | "completed" | "failed";
    dispatchedAt: string;
  }>;
}

export interface CoordinatorStatusResponse {
  coordinator: CoordinatorState;
}

// ── Dispatch types ──────────────────────────────────────

export interface DispatchResponse {
  ok: boolean;
  issueNumber: number;
  status: string;
}

// ── WebSocket event types ───────────────────────────────

export interface WorkflowIssueStateChangedEvent {
  type: "workflow:issue-state-changed";
  owner: string;
  repo: string;
  issueNumber: number;
  oldState: WorkflowState;
  newState: WorkflowState;
}

export interface WorkflowSyncCompletedEvent {
  type: "workflow:sync-completed";
  owner: string;
  repo: string;
  synced: number;
}

export interface WorkflowElicitationEvent {
  type: "workflow:elicitation";
  elicitation: WorkflowElicitation;
}

export interface WorkflowElicitationAnsweredEvent {
  type: "workflow:elicitation-answered";
  elicitationId: string;
  issueNumber: number;
}

export interface WorkflowElicitationTimeoutEvent {
  type: "workflow:elicitation-timeout";
  elicitationId: string;
  issueNumber: number;
}

export type WorkflowEvent =
  | WorkflowIssueStateChangedEvent
  | WorkflowSyncCompletedEvent
  | WorkflowElicitationEvent
  | WorkflowElicitationAnsweredEvent
  | WorkflowElicitationTimeoutEvent
  | WorkflowActivityEvent;
