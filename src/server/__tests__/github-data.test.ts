import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestServer, type FastifyInstance } from "../../test-utils/server.js";
import githubDataRoutes from "../routes/github-data.js";
import type { StateService, ProjectConfig, EnrichmentData } from "../state/types.js";
import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepoMetadata,
  PaginatedResult,
} from "../github/graphql-types.js";
import type { GitHubGraphQL } from "../github/graphql.js";

// ── Factories ───────────────────────────────────────────

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: "Test issue",
    state: "OPEN",
    url: "https://github.com/acme/api/issues/1",
    labels: [],
    assignees: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function makePR(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 10,
    title: "Test PR",
    state: "OPEN",
    url: "https://github.com/acme/api/pull/10",
    isDraft: false,
    labels: [],
    author: { login: "dev", avatarUrl: "https://example.com/avatar" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<GitHubRepoMetadata> = {}): GitHubRepoMetadata {
  return {
    nameWithOwner: "acme/api",
    description: "API service",
    url: "https://github.com/acme/api",
    defaultBranchRef: "main",
    openIssueCount: 5,
    openPrCount: 2,
    isArchived: false,
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

// ── Mocks ───────────────────────────────────────────────

function createMockStateService(
  initialProjects: ProjectConfig["projects"] = [],
): StateService {
  const config: ProjectConfig = { version: 1, projects: [...initialProjects] };

  return {
    getConfig: vi.fn().mockImplementation(async () => ({
      ...config,
      projects: [...config.projects],
    })),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    getPreferences: vi.fn().mockResolvedValue({ version: 1, theme: "system" }),
    savePreferences: vi.fn().mockResolvedValue(undefined),
    getEnrichment: vi.fn().mockResolvedValue({
      version: 1,
      projects: {},
      updatedAt: new Date().toISOString(),
    } satisfies EnrichmentData),
    saveEnrichment: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    getProjectByToken: vi.fn().mockResolvedValue(undefined),
    updateProjectState: vi.fn().mockResolvedValue(undefined),
    getProjectDefaultCopilotAgent: vi.fn().mockResolvedValue(undefined),
    updateProjectDefaultCopilotAgent: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDaemonRegistry() {
  return { getAllDaemons: vi.fn().mockReturnValue([]) };
}

function createMockGraphQL() {
  return {
    listIssues: vi.fn().mockResolvedValue({
      items: [],
      hasNextPage: false,
      endCursor: null,
    } satisfies PaginatedResult<GitHubIssue>),
    listPullRequests: vi.fn().mockResolvedValue({
      items: [],
      hasNextPage: false,
      endCursor: null,
    } satisfies PaginatedResult<GitHubPullRequest>),
    fetchRepoMetadata: vi.fn().mockResolvedValue(makeMetadata()),
    listViewerRepos: vi.fn().mockResolvedValue({ items: [], hasNextPage: false, endCursor: null }),
    fetchIssuesForRepos: vi.fn().mockResolvedValue(new Map()),
    get rateLimit() { return undefined; },
  } as unknown as GitHubGraphQL & {
    listIssues: ReturnType<typeof vi.fn>;
    listPullRequests: ReturnType<typeof vi.fn>;
    fetchRepoMetadata: ReturnType<typeof vi.fn>;
  };
}

async function buildServer(
  initialProjects: ProjectConfig["projects"] = [],
): Promise<{
  server: FastifyInstance;
  stateService: StateService;
  graphql: ReturnType<typeof createMockGraphQL>;
}> {
  const server = await createTestServer();
  const stateService = createMockStateService(initialProjects);
  const graphql = createMockGraphQL();

  server.decorate("githubToken", "ghp_test");
  server.decorate("githubUser", { login: "testuser", avatarUrl: "https://example.com" });
  server.decorate("stateService", stateService);
  server.decorate("githubGraphQL", graphql);
  server.decorate("daemonRegistry", createMockDaemonRegistry());
  await server.register(githubDataRoutes);

  return { server, stateService, graphql };
}

/** Build a full ProjectEntry with sensible defaults for tests. */
function makeProject(overrides: Partial<import("../state/types.js").ProjectEntry> & { owner: string; repo: string }): import("../state/types.js").ProjectEntry {
  return {
    addedAt: "2026-01-01T00:00:00Z",
    runtimeTarget: "local",
    initialized: false,
    daemonToken: "test-token",
    workState: "stopped",
    ...overrides,
  };
}

const TRACKED = [makeProject({ owner: "acme", repo: "api" })];

// ── Tests ───────────────────────────────────────────────

describe("GitHub data routes", () => {
  beforeEach(() => vi.restoreAllMocks());

  // ── GET /api/projects/:owner/:repo/issues ─────────────

  describe("GET /api/projects/:owner/:repo/issues", () => {
    it("returns issues for a tracked project", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      const issues = [makeIssue({ number: 1 }), makeIssue({ number: 2, title: "Another" })];
      graphql.listIssues.mockResolvedValue({ items: issues, hasNextPage: false, endCursor: null });

      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/issues" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.issues).toHaveLength(2);
      expect(body.hasNextPage).toBe(false);
      expect(body.totalFiltered).toBe(2);
    });

    it("returns 404 for untracked project", async () => {
      const { server } = await buildServer();
      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/issues" });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });

    it("filters by state", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      graphql.listIssues.mockResolvedValue({ items: [], hasNextPage: false, endCursor: null });

      await server.inject({ method: "GET", url: "/api/projects/acme/api/issues?state=closed" });

      expect(graphql.listIssues).toHaveBeenCalledWith("acme", "api", expect.objectContaining({ states: ["CLOSED"] }));
    });

    it("filters by label (client-side)", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      const issues = [
        makeIssue({ number: 1, labels: [{ name: "bug", color: "d73a4a" }] }),
        makeIssue({ number: 2, labels: [{ name: "feature", color: "0075ca" }] }),
      ];
      graphql.listIssues.mockResolvedValue({ items: issues, hasNextPage: false, endCursor: null });

      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/issues?label=bug" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.issues).toHaveLength(1);
      expect(body.issues[0].number).toBe(1);
    });

    it("filters by assignee (client-side)", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      const issues = [
        makeIssue({ number: 1, assignees: [{ login: "alice", avatarUrl: "" }] }),
        makeIssue({ number: 2, assignees: [{ login: "bob", avatarUrl: "" }] }),
      ];
      graphql.listIssues.mockResolvedValue({ items: issues, hasNextPage: false, endCursor: null });

      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/issues?assignee=alice" });
      expect(res.statusCode).toBe(200);
      expect(res.json().issues).toHaveLength(1);
    });

    it("supports pagination params", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      graphql.listIssues.mockResolvedValue({ items: [], hasNextPage: true, endCursor: "abc123" });

      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/issues?first=10&after=xyz" });
      expect(res.statusCode).toBe(200);
      expect(graphql.listIssues).toHaveBeenCalledWith("acme", "api", expect.objectContaining({ first: 10, after: "xyz" }));
      expect(res.json().hasNextPage).toBe(true);
      expect(res.json().endCursor).toBe("abc123");
    });

    it("returns 400 for invalid owner format", async () => {
      const { server } = await buildServer(TRACKED);
      const res = await server.inject({ method: "GET", url: "/api/projects/ac%2Fme/api/issues" });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /api/projects/:owner/:repo/pulls ──────────────

  describe("GET /api/projects/:owner/:repo/pulls", () => {
    it("returns pull requests for a tracked project", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      const prs = [makePR({ number: 10 }), makePR({ number: 11, state: "MERGED" })];
      graphql.listPullRequests.mockResolvedValue({ items: prs, hasNextPage: false, endCursor: null });

      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/pulls" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pullRequests).toHaveLength(2);
    });

    it("returns 404 for untracked project", async () => {
      const { server } = await buildServer();
      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/pulls" });
      expect(res.statusCode).toBe(404);
    });

    it("filters by state", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      graphql.listPullRequests.mockResolvedValue({ items: [], hasNextPage: false, endCursor: null });

      await server.inject({ method: "GET", url: "/api/projects/acme/api/pulls?state=merged" });
      expect(graphql.listPullRequests).toHaveBeenCalledWith("acme", "api", expect.objectContaining({ states: ["MERGED"] }));
    });

    it("supports pagination", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      graphql.listPullRequests.mockResolvedValue({ items: [], hasNextPage: true, endCursor: "cur42" });

      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/pulls?first=5" });
      expect(res.json().endCursor).toBe("cur42");
      expect(graphql.listPullRequests).toHaveBeenCalledWith("acme", "api", expect.objectContaining({ first: 5 }));
    });
  });

  // ── GET /api/projects/:owner/:repo/overview ───────────

  describe("GET /api/projects/:owner/:repo/overview", () => {
    it("returns aggregated overview for a tracked project", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      const meta = makeMetadata({ openIssueCount: 12, openPrCount: 3 });
      graphql.fetchRepoMetadata.mockResolvedValue(meta);
      graphql.listIssues.mockResolvedValue({ items: [makeIssue()], hasNextPage: false, endCursor: null });
      graphql.listPullRequests.mockResolvedValue({ items: [makePR()], hasNextPage: false, endCursor: null });

      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/overview" });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.owner).toBe("acme");
      expect(body.repo).toBe("api");
      expect(body.issueCounts.open).toBe(12);
      expect(body.prCounts.open).toBe(3);
      expect(body.recentIssues).toHaveLength(1);
      expect(body.recentPullRequests).toHaveLength(1);
    });

    it("returns 404 for untracked project", async () => {
      const { server } = await buildServer();
      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/overview" });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/dashboard ────────────────────────────────

  describe("GET /api/dashboard", () => {
    it("returns empty dashboard when no projects tracked", async () => {
      const { server } = await buildServer();
      const res = await server.inject({ method: "GET", url: "/api/dashboard" });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.totalProjects).toBe(0);
      expect(body.totalOpenIssues).toBe(0);
      expect(body.totalOpenPrs).toBe(0);
      expect(body.projects).toEqual([]);
    });

    it("aggregates data across all tracked projects", async () => {
      const projects = [
        makeProject({ owner: "acme", repo: "api" }),
        makeProject({ owner: "acme", repo: "ui", addedAt: "2026-02-01T00:00:00Z" }),
      ];
      const { server, graphql } = await buildServer(projects);

      graphql.fetchRepoMetadata
        .mockResolvedValueOnce(makeMetadata({ nameWithOwner: "acme/api", openIssueCount: 5, openPrCount: 2 }))
        .mockResolvedValueOnce(makeMetadata({ nameWithOwner: "acme/ui", openIssueCount: 3, openPrCount: 1 }));

      const res = await server.inject({ method: "GET", url: "/api/dashboard" });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.totalProjects).toBe(2);
      expect(body.totalOpenIssues).toBe(8);
      expect(body.totalOpenPrs).toBe(3);
      expect(body.projects).toHaveLength(2);
    });

    it("handles partial failures gracefully", async () => {
      const projects = [
        makeProject({ owner: "acme", repo: "api" }),
        makeProject({ owner: "acme", repo: "gone", addedAt: "2026-02-01T00:00:00Z" }),
      ];
      const { server, graphql } = await buildServer(projects);

      graphql.fetchRepoMetadata
        .mockResolvedValueOnce(makeMetadata({ openIssueCount: 10, openPrCount: 4 }))
        .mockRejectedValueOnce(new Error("Repo not found"));

      const res = await server.inject({ method: "GET", url: "/api/dashboard" });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.totalProjects).toBe(2);
      expect(body.totalOpenIssues).toBe(10);
      expect(body.totalOpenPrs).toBe(4);
      expect(body.projects).toHaveLength(2);
      // Failed project shows zero counts
      expect(body.projects[1].openIssueCount).toBe(0);
    });
  });

  // ── Error handling ────────────────────────────────────

  describe("Error handling", () => {
    it("returns 429 on rate limit", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      const { GitHubGraphQLError } = await import("../github/graphql.js");
      graphql.listIssues.mockRejectedValue(
        new GitHubGraphQLError("Rate limited", "RATE_LIMITED", {
          limit: 5000,
          remaining: 0,
          resetAt: new Date("2026-03-13T12:00:00Z"),
          used: 5000,
        }),
      );

      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/issues" });
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe("rate_limited");
    });

    it("returns 401 on auth failure", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      const { GitHubGraphQLError } = await import("../github/graphql.js");
      graphql.listIssues.mockRejectedValue(
        new GitHubGraphQLError("Unauthorized", "UNAUTHORIZED"),
      );

      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/issues" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 502 on generic GraphQL error", async () => {
      const { server, graphql } = await buildServer(TRACKED);
      const { GitHubGraphQLError } = await import("../github/graphql.js");
      graphql.listIssues.mockRejectedValue(
        new GitHubGraphQLError("Something broke", "GRAPHQL_ERROR"),
      );

      const res = await server.inject({ method: "GET", url: "/api/projects/acme/api/issues" });
      expect(res.statusCode).toBe(502);
    });
  });
});
