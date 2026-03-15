// ────────────────────────────────────────────────────────
// REST API routes — GitHub project data (issues, PRs, overview, dashboard)
// ────────────────────────────────────────────────────────

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { GitHubGraphQLError } from "../github/graphql.js";
import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepoMetadata,
  PaginatedResult,
} from "../github/graphql-types.js";

// ── Request / Response types ────────────────────────────

interface ProjectParams {
  owner: string;
  repo: string;
}

interface IssuesQuery {
  state?: string;
  label?: string;
  assignee?: string;
  first?: string;
  after?: string;
}

interface PullsQuery {
  state?: string;
  first?: string;
  after?: string;
}

export interface IssuesResponse {
  issues: GitHubIssue[];
  hasNextPage: boolean;
  endCursor: string | null;
  totalFiltered: number;
}

export interface PullsResponse {
  pullRequests: GitHubPullRequest[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface ProjectOverview {
  owner: string;
  repo: string;
  metadata: GitHubRepoMetadata;
  issueCounts: { open: number; closed: number };
  prCounts: { open: number; closed: number; merged: number };
  recentIssues: GitHubIssue[];
  recentPullRequests: GitHubPullRequest[];
}

export interface DashboardProject {
  owner: string;
  repo: string;
  openIssueCount: number;
  openPrCount: number;
  updatedAt: string;
  isArchived: boolean;
  runtimeTarget: string;
  daemonStatus: "online" | "offline";
  workState: string;
}

export interface DashboardResponse {
  totalProjects: number;
  totalOpenIssues: number;
  totalOpenPrs: number;
  projects: DashboardProject[];
}

// ── Validation helpers ──────────────────────────────────

const OWNER_REPO_REGEX = /^[a-zA-Z0-9_.-]+$/;

function isValidOwnerRepo(value: string): boolean {
  return OWNER_REPO_REGEX.test(value) && value.length > 0 && value.length <= 100;
}

function parseIssueStates(state?: string): Array<"OPEN" | "CLOSED"> | undefined {
  if (!state) return undefined;
  const upper = state.toUpperCase();
  if (upper === "OPEN") return ["OPEN"];
  if (upper === "CLOSED") return ["CLOSED"];
  return undefined;
}

function parsePrStates(state?: string): Array<"OPEN" | "CLOSED" | "MERGED"> | undefined {
  if (!state) return undefined;
  const upper = state.toUpperCase();
  if (upper === "OPEN") return ["OPEN"];
  if (upper === "CLOSED") return ["CLOSED"];
  if (upper === "MERGED") return ["MERGED"];
  return undefined;
}

function parseFirst(raw?: string): number {
  const n = Number(raw);
  if (!raw || isNaN(n)) return 30;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

// ── Error handling ──────────────────────────────────────

function handleGraphQLError(reply: FastifyReply, err: unknown) {
  if (err instanceof GitHubGraphQLError) {
    switch (err.code) {
      case "NOT_FOUND":
        return reply.status(404).send({
          error: "not_found",
          message: err.message,
        });
      case "UNAUTHORIZED":
        return reply.status(401).send({
          error: "unauthorized",
          message: err.message,
        });
      case "RATE_LIMITED":
        return reply.status(429).send({
          error: "rate_limited",
          message: err.message,
          resetAt: err.rateLimit?.resetAt?.toISOString(),
        });
      default:
        return reply.status(502).send({
          error: "github_api_error",
          message: err.message,
        });
    }
  }
  throw err;
}

// ── Tracked-project guard ───────────────────────────────

async function assertProjectTracked(
  fastify: { stateService: { getConfig(): Promise<{ projects: Array<{ owner: string; repo: string }> }> } },
  owner: string,
  repo: string,
): Promise<boolean> {
  const config = await fastify.stateService.getConfig();
  return config.projects.some(
    (p) =>
      p.owner.toLowerCase() === owner.toLowerCase() &&
      p.repo.toLowerCase() === repo.toLowerCase(),
  );
}

// ── Daemon status derivation ────────────────────────────

function deriveDaemonStatus(
  fastify: { daemonRegistry: { getAllDaemons(): Array<{ projectId: string; state: string; lastHeartbeat: number }> } },
  owner: string,
  repo: string,
): "online" | "offline" {
  const projectId = `${owner}/${repo}`;
  const daemons = fastify.daemonRegistry.getAllDaemons();
  return daemons.some(
    (d) => d.projectId.toLowerCase() === projectId.toLowerCase() && d.state === "connected",
  )
    ? "online"
    : "offline";
}

// ── Route plugin ────────────────────────────────────────

const githubDataRoutes: FastifyPluginAsync = async (fastify) => {
  // Guard: return 503 for all GitHub data routes when auth is unavailable
  function requireGraphQL(reply: FastifyReply): boolean {
    if (!fastify.githubGraphQL) {
      reply.status(503).send({
        error: "github_unavailable",
        message: "GitHub authentication is not available. Run: gh auth login",
      });
      return false;
    }
    return true;
  }

  // GET /api/projects/:owner/:repo/issues
  fastify.get<{ Params: ProjectParams; Querystring: IssuesQuery }>(
    "/api/projects/:owner/:repo/issues",
    async (request, reply) => {
      if (!requireGraphQL(reply)) return;
      const { owner, repo } = request.params;

      if (!isValidOwnerRepo(owner) || !isValidOwnerRepo(repo)) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Invalid owner or repo name.",
        });
      }

      const tracked = await assertProjectTracked(fastify, owner, repo);
      if (!tracked) {
        return reply.status(404).send({
          error: "not_found",
          message: `Project ${owner}/${repo} is not tracked. Add it first via POST /api/projects.`,
        });
      }

      const query = request.query;
      const states = parseIssueStates(query.state);
      const first = parseFirst(query.first);
      const after = query.after || undefined;

      try {
        const result: PaginatedResult<GitHubIssue> =
          await fastify.githubGraphQL!.listIssues(owner, repo, {
            first,
            after,
            states,
          });

        // Client-side filtering for label and assignee (GraphQL doesn't support these filters directly)
        let filtered = result.items;

        if (query.label) {
          const labelLower = query.label.toLowerCase();
          filtered = filtered.filter((i) =>
            i.labels.some((l) => l.name.toLowerCase() === labelLower),
          );
        }

        if (query.assignee) {
          const assigneeLower = query.assignee.toLowerCase();
          filtered = filtered.filter((i) =>
            i.assignees.some((a) => a.login.toLowerCase() === assigneeLower),
          );
        }

        const response: IssuesResponse = {
          issues: filtered,
          hasNextPage: result.hasNextPage,
          endCursor: result.endCursor,
          totalFiltered: filtered.length,
        };
        return response;
      } catch (err) {
        return handleGraphQLError(reply, err);
      }
    },
  );

  // GET /api/projects/:owner/:repo/pulls
  fastify.get<{ Params: ProjectParams; Querystring: PullsQuery }>(
    "/api/projects/:owner/:repo/pulls",
    async (request, reply) => {
      if (!requireGraphQL(reply)) return;
      const { owner, repo } = request.params;

      if (!isValidOwnerRepo(owner) || !isValidOwnerRepo(repo)) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Invalid owner or repo name.",
        });
      }

      const tracked = await assertProjectTracked(fastify, owner, repo);
      if (!tracked) {
        return reply.status(404).send({
          error: "not_found",
          message: `Project ${owner}/${repo} is not tracked. Add it first via POST /api/projects.`,
        });
      }

      const query = request.query;
      const states = parsePrStates(query.state);
      const first = parseFirst(query.first);
      const after = query.after || undefined;

      try {
        const result: PaginatedResult<GitHubPullRequest> =
          await fastify.githubGraphQL!.listPullRequests(owner, repo, {
            first,
            after,
            states,
          });

        const response: PullsResponse = {
          pullRequests: result.items,
          hasNextPage: result.hasNextPage,
          endCursor: result.endCursor,
        };
        return response;
      } catch (err) {
        return handleGraphQLError(reply, err);
      }
    },
  );

  // GET /api/projects/:owner/:repo/overview
  fastify.get<{ Params: ProjectParams }>(
    "/api/projects/:owner/:repo/overview",
    async (request, reply) => {
      if (!requireGraphQL(reply)) return;
      const { owner, repo } = request.params;

      if (!isValidOwnerRepo(owner) || !isValidOwnerRepo(repo)) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Invalid owner or repo name.",
        });
      }

      const tracked = await assertProjectTracked(fastify, owner, repo);
      if (!tracked) {
        return reply.status(404).send({
          error: "not_found",
          message: `Project ${owner}/${repo} is not tracked. Add it first via POST /api/projects.`,
        });
      }

      try {
        // Fetch metadata, open issues, closed issues, and PRs in parallel
        const [metadata, openIssues, closedIssues, openPrs, closedPrs, mergedPrs] =
          await Promise.all([
            fastify.githubGraphQL!.fetchRepoMetadata(owner, repo),
            fastify.githubGraphQL!.listIssues(owner, repo, { first: 5, states: ["OPEN"] }),
            fastify.githubGraphQL!.listIssues(owner, repo, { first: 1, states: ["CLOSED"] }),
            fastify.githubGraphQL!.listPullRequests(owner, repo, { first: 5, states: ["OPEN"] }),
            fastify.githubGraphQL!.listPullRequests(owner, repo, { first: 1, states: ["CLOSED"] }),
            fastify.githubGraphQL!.listPullRequests(owner, repo, { first: 1, states: ["MERGED"] }),
          ]);

        const response: ProjectOverview = {
          owner,
          repo,
          metadata,
          issueCounts: {
            open: metadata.openIssueCount,
            closed: closedIssues.items.length > 0 ? closedIssues.items.length : 0,
          },
          prCounts: {
            open: metadata.openPrCount,
            closed: closedPrs.items.length > 0 ? closedPrs.items.length : 0,
            merged: mergedPrs.items.length > 0 ? mergedPrs.items.length : 0,
          },
          recentIssues: openIssues.items,
          recentPullRequests: openPrs.items,
        };
        return response;
      } catch (err) {
        return handleGraphQLError(reply, err);
      }
    },
  );

  // GET /api/dashboard
  fastify.get("/api/dashboard", async (_request, reply) => {
    if (!requireGraphQL(reply)) return;
    const config = await fastify.stateService.getConfig();
    const projects = config.projects;

    if (projects.length === 0) {
      const response: DashboardResponse = {
        totalProjects: 0,
        totalOpenIssues: 0,
        totalOpenPrs: 0,
        projects: [],
      };
      return response;
    }

    try {
      // Fetch metadata for all tracked projects in parallel
      const metadataResults = await Promise.allSettled(
        projects.map((p) =>
          fastify.githubGraphQL!.fetchRepoMetadata(p.owner, p.repo),
        ),
      );

      const dashboardProjects: DashboardProject[] = [];
      let totalOpenIssues = 0;
      let totalOpenPrs = 0;

      for (let i = 0; i < projects.length; i++) {
        const result = metadataResults[i];
        const project = projects[i];

        if (result.status === "fulfilled") {
          const meta = result.value;
          totalOpenIssues += meta.openIssueCount;
          totalOpenPrs += meta.openPrCount;
          dashboardProjects.push({
            owner: project.owner,
            repo: project.repo,
            openIssueCount: meta.openIssueCount,
            openPrCount: meta.openPrCount,
            updatedAt: meta.updatedAt,
            isArchived: meta.isArchived,
            runtimeTarget: project.runtimeTarget,
            daemonStatus: deriveDaemonStatus(fastify, project.owner, project.repo),
            workState: project.workState,
          });
        } else {
          // Include project but with zero counts on failure
          fastify.log.warn(
            `Failed to fetch metadata for ${project.owner}/${project.repo}: ${result.reason}`,
          );
          dashboardProjects.push({
            owner: project.owner,
            repo: project.repo,
            openIssueCount: 0,
            openPrCount: 0,
            updatedAt: project.addedAt,
            isArchived: false,
            runtimeTarget: project.runtimeTarget,
            daemonStatus: deriveDaemonStatus(fastify, project.owner, project.repo),
            workState: project.workState,
          });
        }
      }

      const response: DashboardResponse = {
        totalProjects: projects.length,
        totalOpenIssues,
        totalOpenPrs,
        projects: dashboardProjects,
      };
      return response;
    } catch (err) {
      return handleGraphQLError(reply, err);
    }
  });
};

export default githubDataRoutes;
