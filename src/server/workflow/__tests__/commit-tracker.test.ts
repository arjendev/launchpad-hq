import { describe, it, expect, beforeEach } from "vitest";
import { parseIssueReferences, CommitTracker } from "../commit-tracker.js";

describe("parseIssueReferences", () => {
  it("extracts simple issue reference", () => {
    expect(parseIssueReferences("Fix bug in #42")).toEqual([42]);
  });

  it("extracts multiple references", () => {
    expect(parseIssueReferences("Relates to #1 and #2")).toEqual([1, 2]);
  });

  it("extracts 'fixes' pattern", () => {
    expect(parseIssueReferences("fixes #10")).toEqual([10]);
  });

  it("extracts 'Fixes' pattern (case-insensitive)", () => {
    expect(parseIssueReferences("Fixes #10")).toEqual([10]);
  });

  it("extracts 'fixed' pattern", () => {
    expect(parseIssueReferences("fixed #5")).toEqual([5]);
  });

  it("extracts 'closes' pattern", () => {
    expect(parseIssueReferences("closes #7")).toEqual([7]);
  });

  it("extracts 'closed' pattern", () => {
    expect(parseIssueReferences("closed #8")).toEqual([8]);
  });

  it("extracts 'resolves' pattern", () => {
    expect(parseIssueReferences("resolves #9")).toEqual([9]);
  });

  it("extracts 'resolved' pattern", () => {
    expect(parseIssueReferences("resolved #11")).toEqual([11]);
  });

  it("deduplicates issue numbers", () => {
    expect(parseIssueReferences("fixes #1, closes #1")).toEqual([1]);
  });

  it("handles mixed patterns", () => {
    const refs = parseIssueReferences("feat: implement dispatch (#72), fixes #42, closes #13");
    expect(refs).toContain(72);
    expect(refs).toContain(42);
    expect(refs).toContain(13);
    expect(refs).toHaveLength(3);
  });

  it("returns empty for no references", () => {
    expect(parseIssueReferences("Just a regular commit")).toEqual([]);
  });

  it("ignores zero or negative numbers", () => {
    expect(parseIssueReferences("#0")).toEqual([]);
  });

  it("handles commit messages with newlines", () => {
    expect(parseIssueReferences("feat: add feature\n\nfixes #5")).toEqual([5]);
  });
});

describe("CommitTracker", () => {
  let tracker: CommitTracker;

  beforeEach(() => {
    tracker = new CommitTracker();
  });

  it("tracks a commit with issue references", () => {
    const commit = tracker.addCommit("owner", "repo", "abc123", "fixes #42", "alice");
    expect(commit.sha).toBe("abc123");
    expect(commit.issueNumbers).toEqual([42]);
    expect(commit.author).toBe("alice");
  });

  it("deduplicates by SHA", () => {
    tracker.addCommit("owner", "repo", "abc123", "fixes #42", "alice");
    tracker.addCommit("owner", "repo", "abc123", "fixes #42", "alice");
    expect(tracker.getAllCommits("owner", "repo")).toHaveLength(1);
  });

  it("indexes commits by issue number", () => {
    tracker.addCommit("owner", "repo", "abc123", "fixes #42", "alice");
    tracker.addCommit("owner", "repo", "def456", "closes #42, fixes #10", "bob");

    const commits42 = tracker.getCommitsForIssue("owner", "repo", 42);
    expect(commits42).toHaveLength(2);

    const commits10 = tracker.getCommitsForIssue("owner", "repo", 10);
    expect(commits10).toHaveLength(1);
    expect(commits10[0].sha).toBe("def456");
  });

  it("returns empty for unknown issue", () => {
    expect(tracker.getCommitsForIssue("owner", "repo", 999)).toEqual([]);
  });

  it("returns empty for unknown project", () => {
    expect(tracker.getAllCommits("unknown", "repo")).toEqual([]);
  });

  it("serializes and restores", () => {
    tracker.addCommit("owner", "repo", "abc123", "fixes #42", "alice");
    tracker.addCommit("owner", "repo", "def456", "closes #10", "bob");

    const json = tracker.toJSON("owner", "repo");
    expect(json).toHaveLength(2);

    const newTracker = new CommitTracker();
    newTracker.loadCommits("owner", "repo", json);

    expect(newTracker.getAllCommits("owner", "repo")).toHaveLength(2);
    expect(newTracker.getCommitsForIssue("owner", "repo", 42)).toHaveLength(1);
    expect(newTracker.getCommitsForIssue("owner", "repo", 10)).toHaveLength(1);
  });

  it("tracks commits across projects independently", () => {
    tracker.addCommit("owner1", "repo1", "abc", "fixes #1");
    tracker.addCommit("owner2", "repo2", "def", "fixes #1");

    expect(tracker.getAllCommits("owner1", "repo1")).toHaveLength(1);
    expect(tracker.getAllCommits("owner2", "repo2")).toHaveLength(1);
    expect(tracker.getCommitsForIssue("owner1", "repo1", 1)).toHaveLength(1);
    expect(tracker.getCommitsForIssue("owner2", "repo2", 1)).toHaveLength(1);
  });

  it("handles commits with no issue references", () => {
    const commit = tracker.addCommit("owner", "repo", "abc", "update README");
    expect(commit.issueNumbers).toEqual([]);
    expect(tracker.getAllCommits("owner", "repo")).toHaveLength(1);
  });
});
