/**
 * GitHub Issues Sync Service
 *
 * Reads issues from a project's GitHub repo using `gh` CLI,
 * maps them to WorkflowIssue objects, and syncs HQ state back
 * via labels and comments.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  WorkflowIssue,
  WorkflowState,
  FeedbackEntry,
} from "./state-machine.js";
import {
  labelToState,
  stateToLabel,
  HQ_LABELS,
} from "./state-machine.js";

const execFileAsync = promisify(execFile);

// --- Types ---

interface GitHubIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  assignees: Array<{ login: string }>;
  labels: Array<{ name: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface SyncResult {
  issues: WorkflowIssue[];
  added: number;
  updated: number;
  errors: string[];
}

// States that trigger a comment on the GitHub issue
const COMMENT_STATES: ReadonlySet<WorkflowState> = new Set([
  "needs-input-blocking",
  "needs-input-async",
  "done",
]);

// --- Service ---

export class GitHubSyncService {
  constructor(
    private readonly ghToken: string,
  ) {}

  /**
   * Fetch issues from GitHub and merge with existing HQ state.
   * Existing tracked issues keep their HQ state; new issues start in backlog.
   */
  async syncIssues(
    owner: string,
    repo: string,
    existing: Map<number, WorkflowIssue>,
  ): Promise<SyncResult> {
    const ghIssues = await this.fetchIssues(owner, repo);
    const errors: string[] = [];
    let added = 0;
    let updated = 0;

    const issues: WorkflowIssue[] = ghIssues.map((gh) => {
      const tracked = existing.get(gh.number);
      if (tracked) {
        updated++;
        return {
          ...tracked,
          title: gh.title,
          githubState: gh.state === "OPEN" ? "open" as const : "closed" as const,
          assignee: gh.assignees[0]?.login ?? null,
          labels: gh.labels.map((l) => l.name),
          updatedAt: gh.updatedAt,
        };
      }

      // New issue: derive initial state from existing labels or default to backlog
      const hqLabel = gh.labels.find((l) => HQ_LABELS.includes(l.name));
      const derivedState: WorkflowState = hqLabel ? (labelToState(hqLabel.name) ?? "backlog") : "backlog";

      added++;
      return {
        owner,
        repo,
        number: gh.number,
        title: gh.title,
        state: derivedState,
        githubState: gh.state === "OPEN" ? "open" as const : "closed" as const,
        assignee: gh.assignees[0]?.login ?? null,
        labels: gh.labels.map((l) => l.name),
        createdAt: gh.createdAt,
        updatedAt: gh.updatedAt,
        stateChangedAt: new Date().toISOString(),
        feedback: [],
      };
    });

    return { issues, added, updated, errors };
  }

  /** Push HQ state label to a GitHub issue. Removes other hq: labels first. */
  async syncLabelToGitHub(
    owner: string,
    repo: string,
    issueNumber: number,
    state: WorkflowState,
  ): Promise<void> {
    const targetLabel = stateToLabel(state);

    // Remove existing hq: labels
    for (const label of HQ_LABELS) {
      if (label !== targetLabel) {
        await this.removeLabel(owner, repo, issueNumber, label).catch(() => {
          // Label may not exist on the issue — ignore
        });
      }
    }

    // Add the target label
    await this.addLabel(owner, repo, issueNumber, targetLabel);
  }

  /** Post a comment on transition (only for input requests and completion). */
  async postTransitionComment(
    owner: string,
    repo: string,
    issueNumber: number,
    fromState: WorkflowState,
    toState: WorkflowState,
    reason?: string,
  ): Promise<void> {
    if (!COMMENT_STATES.has(toState)) return;

    let body: string;
    switch (toState) {
      case "needs-input-blocking":
        body = `🔴 **HQ: Blocking input needed**\n\nThis issue requires input before work can continue.${reason ? `\n\n> ${reason}` : ""}`;
        break;
      case "needs-input-async":
        body = `🟡 **HQ: Async input requested**\n\nInput requested — work continues in parallel.${reason ? `\n\n> ${reason}` : ""}`;
        break;
      case "done":
        body = `✅ **HQ: Completed**\n\nThis issue has been marked as done in HQ.`;
        break;
      default:
        return;
    }

    await this.ghCli(["issue", "comment", String(issueNumber), "--repo", `${owner}/${repo}`, "--body", body]);
  }

  /** Post async feedback as a comment on the issue. */
  async postFeedbackComment(
    owner: string,
    repo: string,
    issueNumber: number,
    feedback: FeedbackEntry,
  ): Promise<void> {
    const body = `💬 **HQ Feedback** from ${feedback.author}:\n\n${feedback.message}`;
    await this.ghCli(["issue", "comment", String(issueNumber), "--repo", `${owner}/${repo}`, "--body", body]);
  }

  // --- Private helpers ---

  private async fetchIssues(owner: string, repo: string): Promise<GitHubIssue[]> {
    const { stdout } = await this.ghCli([
      "issue", "list",
      "--repo", `${owner}/${repo}`,
      "--state", "all",
      "--limit", "200",
      "--json", "number,title,state,assignees,labels,createdAt,updatedAt",
    ]);

    return JSON.parse(stdout) as GitHubIssue[];
  }

  private async addLabel(
    owner: string,
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<void> {
    await this.ghCli([
      "issue", "edit", String(issueNumber),
      "--repo", `${owner}/${repo}`,
      "--add-label", label,
    ]);
  }

  private async removeLabel(
    owner: string,
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<void> {
    await this.ghCli([
      "issue", "edit", String(issueNumber),
      "--repo", `${owner}/${repo}`,
      "--remove-label", label,
    ]);
  }

  private async ghCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("gh", args, {
      env: {
        ...process.env,
        GH_TOKEN: this.ghToken,
      },
      timeout: 30_000,
    });
  }
}
