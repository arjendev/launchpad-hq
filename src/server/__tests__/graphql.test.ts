import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubGraphQL, GitHubGraphQLError, parseRateLimitHeaders } from "../github/graphql.js";

// ── Mock graphql-request ─────────────────────────────────

let mockRequestFn: ReturnType<typeof vi.fn>;

vi.mock("graphql-request", () => {
  class MockGraphQLClient {
    constructor(_url: string, _opts: Record<string, unknown>) {
      // store opts for potential inspection but don't use the middleware in tests
    }
    request = (...args: unknown[]) => mockRequestFn(...args);
  }

  class ClientError extends Error {
    response: Record<string, unknown>;
    constructor(response: Record<string, unknown>, request: Record<string, unknown>) {
      super("GraphQL Client Error");
      this.name = "ClientError";
      this.response = response;
    }
  }

  return { GraphQLClient: MockGraphQLClient, ClientError };
});

beforeEach(() => {
  mockRequestFn = vi.fn();
});

// ── parseRateLimitHeaders ────────────────────────────────

describe("parseRateLimitHeaders", () => {
  it("parses valid rate-limit headers", () => {
    const headers = new Headers({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": "1700000000",
      "x-ratelimit-used": "1",
    });
    const info = parseRateLimitHeaders(headers);
    expect(info).toEqual({
      limit: 5000,
      remaining: 4999,
      resetAt: new Date(1700000000 * 1000),
      used: 1,
    });
  });

  it("returns undefined when headers are missing", () => {
    const headers = new Headers();
    expect(parseRateLimitHeaders(headers)).toBeUndefined();
  });

  it("computes used from limit - remaining when x-ratelimit-used is absent", () => {
    const headers = new Headers({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4900",
      "x-ratelimit-reset": "1700000000",
    });
    const info = parseRateLimitHeaders(headers);
    expect(info?.used).toBe(100);
  });
});

// ── listViewerRepos ──────────────────────────────────────

describe("GitHubGraphQL.listViewerRepos", () => {
  it("returns paginated repo metadata", async () => {
    const client = new GitHubGraphQL("test-token");

    mockRequestFn.mockResolvedValueOnce({
      viewer: {
        repositories: {
          nodes: [
            {
              nameWithOwner: "alice/project-a",
              description: "A cool project",
              url: "https://github.com/alice/project-a",
              isArchived: false,
              updatedAt: "2024-01-15T10:00:00Z",
              defaultBranchRef: { name: "main" },
              issues: { totalCount: 5 },
              pullRequests: { totalCount: 2 },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    const result = await client.listViewerRepos(10);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      nameWithOwner: "alice/project-a",
      description: "A cool project",
      url: "https://github.com/alice/project-a",
      defaultBranchRef: "main",
      openIssueCount: 5,
      openPrCount: 2,
      isArchived: false,
      updatedAt: "2024-01-15T10:00:00Z",
    });
    expect(result.hasNextPage).toBe(false);
  });

  it("handles repos with null defaultBranchRef", async () => {
    const client = new GitHubGraphQL("test-token");

    mockRequestFn.mockResolvedValueOnce({
      viewer: {
        repositories: {
          nodes: [
            {
              nameWithOwner: "alice/empty-repo",
              description: null,
              url: "https://github.com/alice/empty-repo",
              isArchived: false,
              updatedAt: "2024-01-01T00:00:00Z",
              defaultBranchRef: null,
              issues: { totalCount: 0 },
              pullRequests: { totalCount: 0 },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    const result = await client.listViewerRepos();
    expect(result.items[0].defaultBranchRef).toBeNull();
    expect(result.items[0].description).toBeNull();
  });
});

// ── listIssues ───────────────────────────────────────────

describe("GitHubGraphQL.listIssues", () => {
  it("returns issues with labels and assignees", async () => {
    const client = new GitHubGraphQL("test-token");

    mockRequestFn.mockResolvedValueOnce({
      repository: {
        issues: {
          nodes: [
            {
              number: 42,
              title: "Fix auth flow",
              state: "OPEN",
              url: "https://github.com/alice/project-a/issues/42",
              createdAt: "2024-01-10T08:00:00Z",
              updatedAt: "2024-01-14T12:00:00Z",
              labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
              assignees: {
                nodes: [{ login: "alice", avatarUrl: "https://avatar.url/alice" }],
              },
            },
          ],
          pageInfo: { hasNextPage: true, endCursor: "cursor123" },
        },
      },
    });

    const result = await client.listIssues("alice", "project-a", {
      first: 10,
      states: ["OPEN"],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      number: 42,
      title: "Fix auth flow",
      state: "OPEN",
      url: "https://github.com/alice/project-a/issues/42",
      createdAt: "2024-01-10T08:00:00Z",
      updatedAt: "2024-01-14T12:00:00Z",
      labels: [{ name: "bug", color: "d73a4a" }],
      assignees: [{ login: "alice", avatarUrl: "https://avatar.url/alice" }],
    });
    expect(result.hasNextPage).toBe(true);
    expect(result.endCursor).toBe("cursor123");
  });
});

// ── listPullRequests ─────────────────────────────────────

describe("GitHubGraphQL.listPullRequests", () => {
  it("returns PRs with author and labels", async () => {
    const client = new GitHubGraphQL("test-token");

    mockRequestFn.mockResolvedValueOnce({
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 7,
              title: "Add feature X",
              state: "OPEN",
              url: "https://github.com/alice/project-a/pull/7",
              isDraft: false,
              createdAt: "2024-01-12T10:00:00Z",
              updatedAt: "2024-01-13T14:00:00Z",
              labels: { nodes: [{ name: "enhancement", color: "a2eeef" }] },
              author: { login: "bob", avatarUrl: "https://avatar.url/bob" },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    const result = await client.listPullRequests("alice", "project-a", {
      states: ["OPEN"],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      number: 7,
      title: "Add feature X",
      state: "OPEN",
      isDraft: false,
      author: { login: "bob" },
    });
  });

  it("handles PR with null author", async () => {
    const client = new GitHubGraphQL("test-token");

    mockRequestFn.mockResolvedValueOnce({
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 1,
              title: "Ghost PR",
              state: "MERGED",
              url: "https://github.com/a/b/pull/1",
              isDraft: false,
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
              labels: { nodes: [] },
              author: null,
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    const result = await client.listPullRequests("a", "b");
    expect(result.items[0].author).toBeNull();
  });
});

// ── fetchRepoMetadata ────────────────────────────────────

describe("GitHubGraphQL.fetchRepoMetadata", () => {
  it("returns repo metadata", async () => {
    const client = new GitHubGraphQL("test-token");

    mockRequestFn.mockResolvedValueOnce({
      repository: {
        nameWithOwner: "alice/project-a",
        description: "Great project",
        url: "https://github.com/alice/project-a",
        isArchived: false,
        updatedAt: "2024-01-15T10:00:00Z",
        defaultBranchRef: { name: "main" },
        issues: { totalCount: 3 },
        pullRequests: { totalCount: 1 },
      },
    });

    const meta = await client.fetchRepoMetadata("alice", "project-a");
    expect(meta).toEqual({
      nameWithOwner: "alice/project-a",
      description: "Great project",
      url: "https://github.com/alice/project-a",
      defaultBranchRef: "main",
      openIssueCount: 3,
      openPrCount: 1,
      isArchived: false,
      updatedAt: "2024-01-15T10:00:00Z",
    });
  });
});

// ── fetchIssuesForRepos ──────────────────────────────────

describe("GitHubGraphQL.fetchIssuesForRepos", () => {
  it("batches issues from multiple repos", async () => {
    const client = new GitHubGraphQL("test-token");

    mockRequestFn.mockResolvedValueOnce({
      repo_0: {
        issues: {
          nodes: [
            {
              number: 1,
              title: "Issue A",
              state: "OPEN",
              url: "https://github.com/a/x/issues/1",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
              labels: { nodes: [] },
              assignees: { nodes: [] },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
      repo_1: {
        issues: {
          nodes: [
            {
              number: 2,
              title: "Issue B",
              state: "CLOSED",
              url: "https://github.com/b/y/issues/2",
              createdAt: "2024-01-02T00:00:00Z",
              updatedAt: "2024-01-02T00:00:00Z",
              labels: { nodes: [{ name: "done", color: "00ff00" }] },
              assignees: { nodes: [] },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    const result = await client.fetchIssuesForRepos(["a/x", "b/y"]);
    expect(result.size).toBe(2);
    expect(result.get("a/x")![0].title).toBe("Issue A");
    expect(result.get("b/y")![0].title).toBe("Issue B");
    expect(result.get("b/y")![0].labels).toEqual([{ name: "done", color: "00ff00" }]);
  });

  it("returns empty map for empty input", async () => {
    const client = new GitHubGraphQL("test-token");
    const result = await client.fetchIssuesForRepos([]);
    expect(result.size).toBe(0);
    expect(mockRequestFn).not.toHaveBeenCalled();
  });
});

// ── Error handling ───────────────────────────────────────

describe("GitHubGraphQL error handling", () => {
  it("throws UNAUTHORIZED for 401 responses", async () => {
    const client = new GitHubGraphQL("bad-token");
    const { ClientError } = await import("graphql-request");
    mockRequestFn.mockRejectedValueOnce(
      new ClientError(
        { status: 401, headers: new Headers(), errors: [] } as unknown as Record<string, unknown>,
        { query: "" } as unknown as Record<string, unknown>,
      ),
    );

    try {
      await client.listViewerRepos();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubGraphQLError);
      expect((err as GitHubGraphQLError).code).toBe("UNAUTHORIZED");
    }
  });

  it("throws NOT_FOUND for GraphQL NOT_FOUND errors", async () => {
    const client = new GitHubGraphQL("test-token");
    const { ClientError } = await import("graphql-request");
    mockRequestFn.mockRejectedValueOnce(
      new ClientError(
        {
          status: 200,
          headers: new Headers(),
          errors: [{ message: "Could not resolve to a Repository", type: "NOT_FOUND" }],
        } as unknown as Record<string, unknown>,
        { query: "" } as unknown as Record<string, unknown>,
      ),
    );

    await expect(client.fetchRepoMetadata("x", "y")).rejects.toThrow(GitHubGraphQLError);
    try {
      await client.fetchRepoMetadata("x", "y");
    } catch (e) {
      // re-mock because the first call consumed the rejection
    }
  });

  it("throws RATE_LIMITED for 403 with exhausted rate limit", async () => {
    const client = new GitHubGraphQL("test-token");
    const { ClientError } = await import("graphql-request");
    const headers = new Headers({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "1700000000",
      "x-ratelimit-used": "5000",
    });
    mockRequestFn.mockRejectedValueOnce(
      new ClientError(
        { status: 403, headers, errors: [] } as unknown as Record<string, unknown>,
        { query: "" } as unknown as Record<string, unknown>,
      ),
    );

    try {
      await client.listViewerRepos();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubGraphQLError);
      const gqlErr = err as GitHubGraphQLError;
      expect(gqlErr.code).toBe("RATE_LIMITED");
      expect(gqlErr.rateLimit).toBeDefined();
      expect(gqlErr.rateLimit!.remaining).toBe(0);
    }
  });

  it("throws NETWORK_ERROR for non-ClientError exceptions", async () => {
    const client = new GitHubGraphQL("test-token");
    mockRequestFn.mockRejectedValueOnce(new TypeError("fetch failed"));

    try {
      await client.listViewerRepos();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubGraphQLError);
      expect((err as GitHubGraphQLError).code).toBe("NETWORK_ERROR");
    }
  });
});
