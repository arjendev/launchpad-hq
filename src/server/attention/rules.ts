/**
 * @deprecated The attention rule engine is superseded by the Activity Feed and Status Badges (Phase 4 — #72).
 * Scheduled for removal in a future release. Use /api/workflow/activity and /api/workflow/status endpoints instead.
 */

// ────────────────────────────────────────────────────────
// Attention rule engine — evaluates project data against rules
// ────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import type { GitHubGraphQL } from "../github/graphql.js";
import type { GitHubIssue, GitHubPullRequest } from "../github/graphql-types.js";
import type {
  AttentionItem,
  AttentionRuleConfig,
  AttentionType,
  AttentionSeverity,
} from "./types.js";

/** Generate a deterministic ID for an attention item. */
export function itemId(
  type: AttentionType,
  project: string,
  sourceId: string,
): string {
  const hash = createHash("sha256")
    .update(`${type}:${project}:${sourceId}`)
    .digest("hex")
    .slice(0, 12);
  return `attn_${hash}`;
}

function makeItem(
  type: AttentionType,
  severity: AttentionSeverity,
  project: string,
  message: string,
  sourceId: string,
  url?: string,
): AttentionItem {
  return {
    id: itemId(type, project, sourceId),
    type,
    severity,
    project,
    message,
    createdAt: new Date().toISOString(),
    url,
    sourceId,
    dismissed: false,
  };
}

// ── Individual rule evaluators ──────────────────────────

/** Stale issue: open issue with no activity for N days. */
export function evaluateStaleIssues(
  project: string,
  issues: GitHubIssue[],
  staleDays: number,
  now: Date = new Date(),
): AttentionItem[] {
  const cutoff = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);
  const items: AttentionItem[] = [];

  for (const issue of issues) {
    if (issue.state !== "OPEN") continue;
    const updatedAt = new Date(issue.updatedAt);
    if (updatedAt < cutoff) {
      const daysSince = Math.floor(
        (now.getTime() - updatedAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      const severity: AttentionSeverity =
        daysSince > staleDays * 2 ? "critical" : "warning";
      items.push(
        makeItem(
          "issue_stale",
          severity,
          project,
          `Issue #${issue.number} "${issue.title}" has had no activity for ${daysSince} days`,
          String(issue.number),
          issue.url,
        ),
      );
    }
  }
  return items;
}

/** PR needs review: open PR with no reviews (using reviewDecision if available). */
export function evaluatePrNeedsReview(
  project: string,
  pullRequests: GitHubPullRequest[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const pr of pullRequests) {
    if (pr.state !== "OPEN" || pr.isDraft) continue;
    // Any open non-draft PR is flagged — we don't have review data in the current GraphQL types
    items.push(
      makeItem(
        "pr_needs_review",
        "warning",
        project,
        `PR #${pr.number} "${pr.title}" is open and may need review`,
        String(pr.number),
        pr.url,
      ),
    );
  }
  return items;
}

/** CI failing: check the most recent commit status via REST (stub for now — generates items from PR data). */
export function evaluateCiFailing(
  project: string,
  pullRequests: GitHubPullRequest[],
): AttentionItem[] {
  // CI status requires REST API checks — for now we flag open PRs as potential CI items.
  // Full implementation would use the checks API.
  return [];
}

/** Session idle: placeholder — generates items when session data is available. */
export function evaluateSessionIdle(
  _project: string,
  _params: { idleMinutes: number },
): AttentionItem[] {
  // Will be implemented when Copilot SDK session data is available (#15)
  return [];
}

// ── Rule engine ─────────────────────────────────────────

export interface RuleEvaluationContext {
  project: string;
  issues: GitHubIssue[];
  pullRequests: GitHubPullRequest[];
}

/** Evaluate all enabled rules for a single project. */
export function evaluateRules(
  rules: AttentionRuleConfig[],
  context: RuleEvaluationContext,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    switch (rule.type) {
      case "issue_stale": {
        const staleDays = (rule.params.staleDays as number) ?? 14;
        items.push(
          ...evaluateStaleIssues(
            context.project,
            context.issues,
            staleDays,
          ),
        );
        break;
      }
      case "pr_needs_review":
        items.push(
          ...evaluatePrNeedsReview(context.project, context.pullRequests),
        );
        break;
      case "ci_failing":
        items.push(
          ...evaluateCiFailing(context.project, context.pullRequests),
        );
        break;
      case "session_idle": {
        const idleMinutes = (rule.params.idleMinutes as number) ?? 5;
        items.push(
          ...evaluateSessionIdle(context.project, { idleMinutes }),
        );
        break;
      }
    }
  }

  return items;
}

/** Fetch project data and evaluate rules. */
export async function evaluateProjectAttention(
  graphql: GitHubGraphQL,
  rules: AttentionRuleConfig[],
  owner: string,
  repo: string,
): Promise<AttentionItem[]> {
  const project = `${owner}/${repo}`;

  try {
    const [issuesResult, prsResult] = await Promise.all([
      graphql.listIssues(owner, repo, { first: 50, states: ["OPEN"] }),
      graphql.listPullRequests(owner, repo, { first: 30, states: ["OPEN"] }),
    ]);

    return evaluateRules(rules, {
      project,
      issues: issuesResult.items,
      pullRequests: prsResult.items,
    });
  } catch (err) {
    // If we can't fetch data, don't crash — just return empty
    return [];
  }
}
