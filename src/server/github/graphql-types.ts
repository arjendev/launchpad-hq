// ────────────────────────────────────────────────────────
// GitHub GraphQL response types
// ────────────────────────────────────────────────────────

/** GitHub GraphQL error codes we handle explicitly. */
export type GitHubGraphQLErrorCode =
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "GRAPHQL_ERROR"
  | "NETWORK_ERROR";

/** Label on an issue or PR. */
export interface GitHubLabel {
  name: string;
  color: string;
}

/** Minimal user reference (assignee, author, etc.). */
export interface GitHubActor {
  login: string;
  avatarUrl: string;
}

/** A single GitHub issue. */
export interface GitHubIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  url: string;
  labels: GitHubLabel[];
  assignees: GitHubActor[];
  createdAt: string;
  updatedAt: string;
}

/** A single GitHub pull request. */
export interface GitHubPullRequest {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  url: string;
  isDraft: boolean;
  labels: GitHubLabel[];
  author: GitHubActor | null;
  createdAt: string;
  updatedAt: string;
}

/** Repository metadata. */
export interface GitHubRepoMetadata {
  nameWithOwner: string;
  description: string | null;
  url: string;
  defaultBranchRef: string | null;
  openIssueCount: number;
  openPrCount: number;
  isArchived: boolean;
  updatedAt: string;
}

/** Rate-limit info extracted from response headers. */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: Date;
  used: number;
}

/** Paginated result wrapper. */
export interface PaginatedResult<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor: string | null;
}

// ── Raw GraphQL response shapes (internal) ──────────────

export interface RawPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface RawLabelNode {
  name: string;
  color: string;
}

export interface RawActorNode {
  login: string;
  avatarUrl: string;
}

export interface RawIssueNode {
  number: number;
  title: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  labels: { nodes: RawLabelNode[] };
  assignees: { nodes: RawActorNode[] };
}

export interface RawPullRequestNode {
  number: number;
  title: string;
  state: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  labels: { nodes: RawLabelNode[] };
  author: RawActorNode | null;
}

export interface RawRepoNode {
  nameWithOwner: string;
  description: string | null;
  url: string;
  isArchived: boolean;
  updatedAt: string;
  defaultBranchRef: { name: string } | null;
  issues: { totalCount: number };
  pullRequests: { totalCount: number };
}

export interface ViewerReposResponse {
  viewer: {
    repositories: {
      nodes: RawRepoNode[];
      pageInfo: RawPageInfo;
    };
  };
}

export interface RepoIssuesResponse {
  repository: {
    issues: {
      nodes: RawIssueNode[];
      pageInfo: RawPageInfo;
    };
  };
}

export interface RepoPullRequestsResponse {
  repository: {
    pullRequests: {
      nodes: RawPullRequestNode[];
      pageInfo: RawPageInfo;
    };
  };
}

export interface RepoMetadataResponse {
  repository: RawRepoNode;
}

export interface BatchIssuesResponse {
  [alias: string]: {
    issues: {
      nodes: RawIssueNode[];
      pageInfo: RawPageInfo;
    };
  };
}
