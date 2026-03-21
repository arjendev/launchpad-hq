// ────────────────────────────────────────────────────────
// GitHub GraphQL client
// ────────────────────────────────────────────────────────

import { GraphQLClient, ClientError } from "graphql-request";
import type {
  GitHubGraphQLErrorCode,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepoMetadata,
  RateLimitInfo,
  PaginatedResult,
  ViewerReposResponse,
  RepoIssuesResponse,
  RepoPullRequestsResponse,
  RepoMetadataResponse,
  BatchIssuesResponse,
  RawIssueNode,
  RawPullRequestNode,
  RawRepoNode,
} from "./graphql-types.js";
import { getTracer, isTracingEnabled } from "../observability/tracing.js";
import { SpanStatusCode } from "@opentelemetry/api";
import { sanitizeForSpan, sanitizeToJsonAttr } from "../observability/sanitize.js";

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const USER_AGENT = "launchpad-hq";

// ── Error class ─────────────────────────────────────────

export class GitHubGraphQLError extends Error {
  constructor(
    message: string,
    public readonly code: GitHubGraphQLErrorCode,
    public readonly rateLimit?: RateLimitInfo,
  ) {
    super(message);
    this.name = "GitHubGraphQLError";
  }
}

// ── Rate-limit header parser ────────────────────────────

export function parseRateLimitHeaders(
  headers: Headers,
): RateLimitInfo | undefined {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  const used = headers.get("x-ratelimit-used");

  if (!limit || !remaining || !reset) return undefined;

  return {
    limit: Number(limit),
    remaining: Number(remaining),
    resetAt: new Date(Number(reset) * 1000),
    used: used ? Number(used) : Number(limit) - Number(remaining),
  };
}

// ── Transform helpers ───────────────────────────────────

function toIssue(raw: RawIssueNode): GitHubIssue {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state as GitHubIssue["state"],
    url: raw.url,
    labels: raw.labels.nodes,
    assignees: raw.assignees.nodes,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function toPullRequest(raw: RawPullRequestNode): GitHubPullRequest {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state as GitHubPullRequest["state"],
    url: raw.url,
    isDraft: raw.isDraft,
    labels: raw.labels.nodes,
    author: raw.author,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function toRepoMetadata(raw: RawRepoNode): GitHubRepoMetadata {
  return {
    nameWithOwner: raw.nameWithOwner,
    description: raw.description,
    url: raw.url,
    defaultBranchRef: raw.defaultBranchRef?.name ?? null,
    openIssueCount: raw.issues.totalCount,
    openPrCount: raw.pullRequests.totalCount,
    isArchived: raw.isArchived,
    updatedAt: raw.updatedAt,
  };
}

// ── GraphQL queries ─────────────────────────────────────

const VIEWER_REPOS_QUERY = /* GraphQL */ `
  query ViewerRepos($first: Int!, $after: String) {
    viewer {
      repositories(
        first: $first
        after: $after
        ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        nodes {
          nameWithOwner
          description
          url
          isArchived
          updatedAt
          defaultBranchRef { name }
          issues(states: OPEN) { totalCount }
          pullRequests(states: OPEN) { totalCount }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const REPO_ISSUES_QUERY = /* GraphQL */ `
  query RepoIssues($owner: String!, $name: String!, $first: Int!, $after: String, $states: [IssueState!]) {
    repository(owner: $owner, name: $name) {
      issues(first: $first, after: $after, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          state
          url
          createdAt
          updatedAt
          labels(first: 20) { nodes { name color } }
          assignees(first: 10) { nodes { login avatarUrl } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const REPO_PRS_QUERY = /* GraphQL */ `
  query RepoPullRequests($owner: String!, $name: String!, $first: Int!, $after: String, $states: [PullRequestState!]) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: $first, after: $after, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          state
          url
          isDraft
          createdAt
          updatedAt
          labels(first: 20) { nodes { name color } }
          author { login avatarUrl }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const REPO_METADATA_QUERY = /* GraphQL */ `
  query RepoMetadata($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      nameWithOwner
      description
      url
      isArchived
      updatedAt
      defaultBranchRef { name }
      issues(states: OPEN) { totalCount }
      pullRequests(states: OPEN) { totalCount }
    }
  }
`;

// ── Client class ────────────────────────────────────────

export class GitHubGraphQL {
  private client: GraphQLClient;
  private _lastRateLimit: RateLimitInfo | undefined;

  constructor(token: string) {
    this.client = new GraphQLClient(GITHUB_GRAPHQL_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // Expose response headers for rate-limit tracking
      responseMiddleware: (response) => {
        if (response instanceof Error) return;
        if ("headers" in response && response.headers instanceof Headers) {
          this._lastRateLimit = parseRateLimitHeaders(response.headers);
        }
      },
    });
  }

  /** Last observed rate-limit info (updated after every request). */
  get rateLimit(): RateLimitInfo | undefined {
    return this._lastRateLimit;
  }

  // ── Repos ───────────────────────────────────────────

  /** List repositories for the authenticated user. */
  async listViewerRepos(
    first = 30,
    after?: string,
  ): Promise<PaginatedResult<GitHubRepoMetadata>> {
    const data = await this.request<ViewerReposResponse>(VIEWER_REPOS_QUERY, {
      first,
      after: after ?? null,
    });
    const { nodes, pageInfo } = data.viewer.repositories;
    return {
      items: nodes.map(toRepoMetadata),
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor,
    };
  }

  // ── Issues ──────────────────────────────────────────

  /** List issues for a single repo. */
  async listIssues(
    owner: string,
    name: string,
    opts: {
      first?: number;
      after?: string;
      states?: Array<"OPEN" | "CLOSED">;
    } = {},
  ): Promise<PaginatedResult<GitHubIssue>> {
    const { first = 30, after, states } = opts;
    const data = await this.request<RepoIssuesResponse>(REPO_ISSUES_QUERY, {
      owner,
      name,
      first,
      after: after ?? null,
      states: states ?? null,
    });
    const { nodes, pageInfo } = data.repository.issues;
    return {
      items: nodes.map(toIssue),
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor,
    };
  }

  /**
   * Fetch issues across multiple repos in a single batched query.
   * Uses GraphQL aliases to query multiple repositories at once.
   */
  async fetchIssuesForRepos(
    repos: string[],
    opts: { first?: number; states?: Array<"OPEN" | "CLOSED"> } = {},
  ): Promise<Map<string, GitHubIssue[]>> {
    if (repos.length === 0) return new Map();

    const { first = 30, states } = opts;

    // Build a batched query with aliases for each repo
    const statesArg = states ? `states: [${states.join(", ")}]` : "states: OPEN";
    const fragments = repos.map((repo, i) => {
      const [owner, name] = repo.split("/");
      const alias = `repo_${i}`;
      return `
        ${alias}: repository(owner: "${owner}", name: "${name}") {
          issues(first: ${first}, orderBy: { field: UPDATED_AT, direction: DESC }, ${statesArg}) {
            nodes {
              number
              title
              state
              url
              createdAt
              updatedAt
              labels(first: 20) { nodes { name color } }
              assignees(first: 10) { nodes { login avatarUrl } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;
    });

    const query = `query BatchIssues { ${fragments.join("\n")} }`;
    const data = await this.request<BatchIssuesResponse>(query, {});

    const result = new Map<string, GitHubIssue[]>();
    repos.forEach((repo, i) => {
      const alias = `repo_${i}`;
      const repoData = data[alias];
      result.set(repo, repoData ? repoData.issues.nodes.map(toIssue) : []);
    });
    return result;
  }

  // ── Pull Requests ───────────────────────────────────

  /** List pull requests for a repo. */
  async listPullRequests(
    owner: string,
    name: string,
    opts: {
      first?: number;
      after?: string;
      states?: Array<"OPEN" | "CLOSED" | "MERGED">;
    } = {},
  ): Promise<PaginatedResult<GitHubPullRequest>> {
    const { first = 30, after, states } = opts;
    const data = await this.request<RepoPullRequestsResponse>(
      REPO_PRS_QUERY,
      {
        owner,
        name,
        first,
        after: after ?? null,
        states: states ?? null,
      },
    );
    const { nodes, pageInfo } = data.repository.pullRequests;
    return {
      items: nodes.map(toPullRequest),
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor,
    };
  }

  // ── Repo metadata ───────────────────────────────────

  /** Fetch metadata for a single repository. */
  async fetchRepoMetadata(
    owner: string,
    name: string,
  ): Promise<GitHubRepoMetadata> {
    const data = await this.request<RepoMetadataResponse>(
      REPO_METADATA_QUERY,
      { owner, name },
    );
    return toRepoMetadata(data.repository);
  }

  // ── Internal request wrapper ────────────────────────

  private async request<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    // Extract operation name from query for span naming
    const opMatch = query.match(/(?:query|mutation)\s+(\w+)/);
    const opName = opMatch?.[1] ?? "anonymous";

    if (!isTracingEnabled()) {
      try {
        return await this.client.request<T>(query, variables);
      } catch (err) {
        throw this.wrapError(err);
      }
    }

    const span = getTracer("github-graphql").startSpan(`graphql:${opName}`, {
      attributes: {
        "github.api": "graphql",
        "graphql.operation": opName,
        "http.url": GITHUB_GRAPHQL_ENDPOINT,
      },
    });

    // Attach request details as a span event (strip Authorization from variables)
    span.addEvent("github.request", {
      "graphql.operation": opName,
      ...sanitizeForSpan(variables),
    });

    try {
      const result = await this.client.request<T>(query, variables);
      span.addEvent("github.response", { "response.status": "200", "response.body": sanitizeToJsonAttr(result) });
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.addEvent("github.response", { "response.error": err instanceof Error ? err.message : String(err) });
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw this.wrapError(err);
    } finally {
      span.end();
    }
  }

  private wrapError(err: unknown): GitHubGraphQLError {
    if (err instanceof ClientError) {
      // Parse rate-limit headers from error response
      const headers = err.response?.headers;
      let rateLimit: RateLimitInfo | undefined;
      if (headers instanceof Headers) {
        rateLimit = parseRateLimitHeaders(headers);
      }

      // Check HTTP status
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        // 403 with rate-limit exhausted ⇒ rate limited
        if (rateLimit && rateLimit.remaining === 0) {
          return new GitHubGraphQLError(
            `GitHub API rate limit exceeded. Resets at ${rateLimit.resetAt.toISOString()}`,
            "RATE_LIMITED",
            rateLimit,
          );
        }
        return new GitHubGraphQLError(
          "GitHub authentication failed. Run: gh auth login --refresh",
          "UNAUTHORIZED",
          rateLimit,
        );
      }

      // Check GraphQL-level errors
      const gqlErrors = err.response?.errors;
      if (gqlErrors && gqlErrors.length > 0) {
        const first = gqlErrors[0];
        // GitHub returns a non-standard `type` field on GraphQL errors
        const errType = (first as unknown as { type?: string })?.type;

        if (errType === "NOT_FOUND") {
          return new GitHubGraphQLError(
            first?.message ?? "Resource not found",
            "NOT_FOUND",
            rateLimit,
          );
        }
        if (errType === "RATE_LIMITED") {
          return new GitHubGraphQLError(
            first?.message ?? "Rate limited",
            "RATE_LIMITED",
            rateLimit,
          );
        }

        const messages = gqlErrors.map((e) => e.message).join("; ");
        return new GitHubGraphQLError(
          `GraphQL errors: ${messages}`,
          "GRAPHQL_ERROR",
          rateLimit,
        );
      }

      return new GitHubGraphQLError(
        err.message || "Unknown GraphQL error",
        "GRAPHQL_ERROR",
        rateLimit,
      );
    }

    // Network / unknown errors
    if (err instanceof Error) {
      return new GitHubGraphQLError(
        `Network error: ${err.message}`,
        "NETWORK_ERROR",
      );
    }
    return new GitHubGraphQLError(
      "Unknown error communicating with GitHub",
      "NETWORK_ERROR",
    );
  }
}
