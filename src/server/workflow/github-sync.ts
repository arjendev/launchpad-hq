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
  "rejected",
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

    // Mark previously-tracked issues that are no longer open as done
    const openNumbers = new Set(ghIssues.map((gh) => gh.number));
    for (const [num, tracked] of existing) {
      if (!openNumbers.has(num) && tracked.state !== "done" && tracked.state !== "rejected") {
        issues.push({
          ...tracked,
          state: "done",
          githubState: "closed",
          stateChangedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

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
      case "rejected":
        body = `🚫 **HQ: Rejected**\n\nThis issue has been rejected (won't implement).${reason ? `\n\n> ${reason}` : ""}`;
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

  /** Close a GitHub issue. Used for done and rejected terminal states. */
  async closeIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    reason: "completed" | "not_planned" = "completed",
  ): Promise<void> {
    const args = [
      "issue", "close", String(issueNumber),
      "--repo", `${owner}/${repo}`,
    ];
    if (reason === "not_planned") {
      args.push("--reason", "not planned");
    }
    await this.ghCli(args);
  }

  /** Create a new GitHub issue, returns the issue number. */
  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body?: string,
    labels?: string[],
  ): Promise<{ number: number; title: string }> {
    const args = [
      "issue", "create",
      "--repo", `${owner}/${repo}`,
      "--title", title,
    ];
    if (body) {
      args.push("--body", body);
    }
    const allLabels = [...(labels ?? []), "hq:backlog"];
    // Try with labels first; if label doesn't exist, retry without
    args.push("--label", allLabels.join(","));
    let stdout: string;
    try {
      ({ stdout } = await this.ghCli(args));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        // Label doesn't exist — create without it, add label later
        const argsNoLabel = args.filter((a, i) => a !== "--label" && args[i - 1] !== "--label");
        ({ stdout } = await this.ghCli(argsNoLabel));
      } else {
        throw err;
      }
    }
    // gh issue create outputs the URL; extract the issue number from it
    const match = stdout.trim().match(/\/issues\/(\d+)$/);
    if (!match) {
      throw new Error(`Could not parse issue number from gh output: ${stdout.trim()}`);
    }
    return { number: parseInt(match[1], 10), title };
  }

  /** Get comments for a GitHub issue. */
  async getIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<{ issueBody: string; comments: Array<{ author: string; body: string; createdAt: string }> }> {
    const { stdout } = await this.ghCli([
      "issue", "view", String(issueNumber),
      "--repo", `${owner}/${repo}`,
      "--json", "body,comments",
    ]);
    const raw = JSON.parse(stdout || "{}") as {
      body: string;
      comments: Array<{
        author: { login: string };
        body: string;
        createdAt: string;
      }>;
    };
    return {
      issueBody: raw.body ?? "",
      comments: (raw.comments ?? []).map((c) => ({
        author: c.author.login,
        body: c.body,
        createdAt: c.createdAt,
      })),
    };
  }

  /** Post a comment to a GitHub issue. */
  async addComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<void> {
    await this.ghCli(["issue", "comment", String(issueNumber), "--repo", `${owner}/${repo}`, "--body", body]);
  }

  /** Edit a GitHub issue's title and/or body. */
  async editIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    updates: { title?: string; body?: string },
  ): Promise<void> {
    const args = [
      "issue", "edit", String(issueNumber),
      "--repo", `${owner}/${repo}`,
    ];
    if (updates.title) {
      args.push("--title", updates.title);
    }
    if (updates.body !== undefined) {
      args.push("--body", updates.body);
    }
    await this.ghCli(args);
  }

  // --- Private helpers ---

  private async fetchIssues(owner: string, repo: string): Promise<GitHubIssue[]> {
    const { stdout } = await this.ghCli([
      "issue", "list",
      "--repo", `${owner}/${repo}`,
      "--state", "open",
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
