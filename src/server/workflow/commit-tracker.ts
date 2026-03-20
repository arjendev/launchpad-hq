/**
 * Commit Tracker
 *
 * Parses commit messages for issue references and maintains
 * a per-project map of commit→issue associations.
 */

import type { TrackedCommit } from "../../shared/protocol.js";

// Patterns: #42, fixes #42, closes #42, resolves #42 (case-insensitive)
const ISSUE_REF_PATTERN = /(?:(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+)?#(\d+)/gi;

/**
 * Extract issue numbers referenced in a commit message.
 * Matches: `#42`, `fixes #42`, `closes #42`, `resolves #42`
 */
export function parseIssueReferences(message: string): number[] {
  const matches = message.matchAll(ISSUE_REF_PATTERN);
  const numbers = new Set<number>();
  for (const match of matches) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num) && num > 0) {
      numbers.add(num);
    }
  }
  return [...numbers];
}

/**
 * In-memory commit tracker per project.
 * Stores commits and indexes them by issue number.
 */
export class CommitTracker {
  /** Key = "owner/repo", value = commits */
  private commits = new Map<string, TrackedCommit[]>();
  /** Key = "owner/repo:#issueNumber", value = commit SHAs */
  private issueIndex = new Map<string, Set<string>>();

  private projectKey(owner: string, repo: string): string {
    return `${owner}/${repo}`;
  }

  private issueKey(owner: string, repo: string, issueNumber: number): string {
    return `${owner}/${repo}:#${issueNumber}`;
  }

  /**
   * Track a commit and index it by referenced issues.
   * If the commit was already tracked (by SHA), it's skipped.
   */
  addCommit(
    owner: string,
    repo: string,
    sha: string,
    message: string,
    author: string | null = null,
    timestamp?: string,
  ): TrackedCommit {
    const pk = this.projectKey(owner, repo);
    if (!this.commits.has(pk)) {
      this.commits.set(pk, []);
    }
    const projectCommits = this.commits.get(pk)!;

    // Dedup by SHA
    const existing = projectCommits.find((c) => c.sha === sha);
    if (existing) return existing;

    const issueNumbers = parseIssueReferences(message);
    const commit: TrackedCommit = {
      sha,
      message,
      issueNumbers,
      author,
      timestamp: timestamp ?? new Date().toISOString(),
    };

    projectCommits.push(commit);

    // Index by issue
    for (const num of issueNumbers) {
      const ik = this.issueKey(owner, repo, num);
      if (!this.issueIndex.has(ik)) {
        this.issueIndex.set(ik, new Set());
      }
      this.issueIndex.get(ik)!.add(sha);
    }

    return commit;
  }

  /** Get all commits associated with a specific issue. */
  getCommitsForIssue(owner: string, repo: string, issueNumber: number): TrackedCommit[] {
    const pk = this.projectKey(owner, repo);
    const ik = this.issueKey(owner, repo, issueNumber);
    const shas = this.issueIndex.get(ik);
    if (!shas) return [];

    const projectCommits = this.commits.get(pk) ?? [];
    return projectCommits.filter((c) => shas.has(c.sha));
  }

  /** Get all tracked commits for a project. */
  getAllCommits(owner: string, repo: string): TrackedCommit[] {
    return this.commits.get(this.projectKey(owner, repo)) ?? [];
  }

  /** Serialize for persistence. */
  toJSON(owner: string, repo: string): TrackedCommit[] {
    return this.getAllCommits(owner, repo);
  }

  /** Restore from persisted data. */
  loadCommits(owner: string, repo: string, commits: TrackedCommit[]): void {
    const pk = this.projectKey(owner, repo);
    this.commits.set(pk, []);
    for (const commit of commits) {
      this.addCommit(owner, repo, commit.sha, commit.message, commit.author, commit.timestamp);
    }
  }
}
