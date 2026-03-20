/**
 * Status Badge Computation
 *
 * Derives a project status badge from coordinator state, elicitations,
 * and active issues. Returns one of: idle, working, needs-attention, error.
 */

import type { CoordinatorProjectState } from "../../shared/protocol.js";
import type { WorkflowIssue } from "./state-machine.js";
import type { ElicitationStore } from "./elicitation-store.js";

// --- Types ---

export type ProjectStatusLevel = "idle" | "working" | "needs-attention" | "error";

export interface ProjectStatusBadge {
  owner: string;
  repo: string;
  status: ProjectStatusLevel;
  emoji: string;
  label: string;
  /** Number of issues in-progress (only for 'working' status) */
  activeIssueCount: number;
  /** Details about what needs attention */
  details?: string;
}

const STATUS_META: Record<ProjectStatusLevel, { emoji: string; label: string }> = {
  "idle": { emoji: "🟢", label: "Idle" },
  "working": { emoji: "🔵", label: "Working" },
  "needs-attention": { emoji: "🟡", label: "Needs Attention" },
  "error": { emoji: "🔴", label: "Error" },
};

// --- Computation ---

/**
 * Compute a single project's status badge from its workflow state.
 */
export function computeProjectStatus(
  owner: string,
  repo: string,
  coordinator: CoordinatorProjectState,
  issues: WorkflowIssue[],
  elicitationStore: ElicitationStore,
): ProjectStatusBadge {
  const projectId = `${owner}/${repo}`;
  const meta = (level: ProjectStatusLevel) => STATUS_META[level];

  // Priority 1: coordinator crashed → error
  if (coordinator.status === "crashed") {
    return {
      owner,
      repo,
      status: "error",
      ...meta("error"),
      activeIssueCount: 0,
      details: coordinator.error ?? "Coordinator crashed",
    };
  }

  // Priority 2: pending elicitations or issues needing review → needs-attention
  const pendingElicitations = elicitationStore.getByProject(projectId);
  const reviewIssues = issues.filter((i) => i.state === "ready-for-review");
  const blockingIssues = issues.filter((i) => i.state === "needs-input-blocking");

  if (pendingElicitations.length > 0 || reviewIssues.length > 0 || blockingIssues.length > 0) {
    const parts: string[] = [];
    if (pendingElicitations.length > 0) parts.push(`${pendingElicitations.length} pending elicitation(s)`);
    if (reviewIssues.length > 0) parts.push(`${reviewIssues.length} awaiting review`);
    if (blockingIssues.length > 0) parts.push(`${blockingIssues.length} blocked`);

    return {
      owner,
      repo,
      status: "needs-attention",
      ...meta("needs-attention"),
      activeIssueCount: issues.filter((i) => i.state === "in-progress").length,
      details: parts.join(", "),
    };
  }

  // Priority 3: active issues → working
  const inProgress = issues.filter((i) => i.state === "in-progress" || i.state === "needs-input-async");
  if (inProgress.length > 0 || coordinator.status === "active" || coordinator.status === "starting") {
    return {
      owner,
      repo,
      status: "working",
      ...meta("working"),
      activeIssueCount: inProgress.length,
      details: `${inProgress.length} in progress`,
    };
  }

  // Default: idle
  return {
    owner,
    repo,
    status: "idle",
    ...meta("idle"),
    activeIssueCount: 0,
  };
}
