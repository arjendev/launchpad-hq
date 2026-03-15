import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { ProjectEntry, ProjectConfig } from "../state/types.js";
import type { RuntimeTarget, WorkState } from "../../shared/protocol.js";
import { generateDaemonToken } from "../../shared/auth.js";

// ---- Request / Response types -----------------------------------------------

interface AddProjectBody {
  owner: string;
  repo: string;
  runtimeTarget?: RuntimeTarget;
  daemonToken?: string;
}

interface ProjectParams {
  owner: string;
  repo: string;
}

interface UpdateProjectBody {
  labels?: string[];
  enrichment?: {
    devcontainerStatus?: "active" | "inactive" | "unknown";
    sessionLinks?: string[];
  };
}

/** Project as returned in list endpoints (no daemonToken for security). */
interface ProjectResponse {
  owner: string;
  repo: string;
  addedAt: string;
  runtimeTarget: RuntimeTarget;
  initialized: boolean;
  daemonStatus: "online" | "offline";
  workState: WorkState;
  lastSeen?: number;
}

/** Project detail — includes daemonToken (only on create and explicit detail). */
interface ProjectDetailResponse extends ProjectResponse {
  daemonToken: string;
}

interface ListProjectsResponse {
  projects: ProjectResponse[];
  count: number;
}

interface DiscoverReposQuery {
  page?: number;
  per_page?: number;
  owner?: string;
  q?: string;
}

interface DiscoverUsersQuery {
  q?: string;
}

interface GitHubRepoApiItem {
  full_name: string;
  owner: { login: string };
  name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  language: string | null;
  updated_at: string;
}

interface GitHubSearchRepoItem {
  full_name: string;
  owner: { login: string };
  name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  language: string | null;
  updated_at: string;
}

interface GitHubUserSearchItem {
  login: string;
  type: "User" | "Organization";
  avatar_url: string;
}

// ---- Validation helpers -----------------------------------------------------

const OWNER_REPO_REGEX = /^[a-zA-Z0-9_.-]+$/;

function isValidOwnerRepo(value: string): boolean {
  return OWNER_REPO_REGEX.test(value) && value.length > 0 && value.length <= 100;
}

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: "validation_error", message });
}

const VALID_RUNTIME_TARGETS: ReadonlySet<string> = new Set([
  "wsl-devcontainer",
  "wsl",
  "local",
]);

function isValidRuntimeTarget(value: unknown): value is RuntimeTarget {
  return typeof value === "string" && VALID_RUNTIME_TARGETS.has(value);
}

// ---- GitHub repo existence check --------------------------------------------

async function repoExistsOnGitHub(
  token: string,
  owner: string,
  repo: string,
): Promise<boolean> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "launchpad-hq",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  return response.ok;
}

// ---- Daemon status derivation -----------------------------------------------

function deriveDaemonInfo(
  fastify: { daemonRegistry: { getAllDaemons(): Array<{ projectId: string; state: string; lastHeartbeat: number }> } },
  owner: string,
  repo: string,
): { daemonStatus: "online" | "offline"; lastSeen?: number } {
  const projectId = `${owner}/${repo}`;
  const daemons = fastify.daemonRegistry.getAllDaemons();
  const daemon = daemons.find(
    (d) => d.projectId.toLowerCase() === projectId.toLowerCase() && d.state === "connected",
  );
  if (daemon) {
    return { daemonStatus: "online", lastSeen: daemon.lastHeartbeat };
  }
  return { daemonStatus: "offline" };
}

function toProjectResponse(
  entry: ProjectEntry,
  daemonInfo: { daemonStatus: "online" | "offline"; lastSeen?: number },
): ProjectResponse {
  return {
    owner: entry.owner,
    repo: entry.repo,
    addedAt: entry.addedAt,
    runtimeTarget: entry.runtimeTarget,
    initialized: entry.initialized,
    daemonStatus: daemonInfo.daemonStatus,
    workState: entry.workState,
    lastSeen: daemonInfo.lastSeen,
  };
}

// ---- Route plugin -----------------------------------------------------------

const projectRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/projects — list all tracked projects
  fastify.get("/api/projects", async (_request, _reply): Promise<ListProjectsResponse> => {
    const config = await fastify.stateService.getConfig();
    const projects: ProjectResponse[] = config.projects.map((p) =>
      toProjectResponse(p, deriveDaemonInfo(fastify, p.owner, p.repo)),
    );
    return {
      projects,
      count: projects.length,
    };
  });

  // POST /api/projects — add a project to tracking
  fastify.post("/api/projects", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as AddProjectBody | undefined;

    if (!body || typeof body.owner !== "string" || typeof body.repo !== "string") {
      return validationError(reply, "Request body must include 'owner' and 'repo' as strings.");
    }

    // runtimeTarget is optional; default to "local" if not provided
    const runtimeTarget: RuntimeTarget =
      body.runtimeTarget && isValidRuntimeTarget(body.runtimeTarget)
        ? body.runtimeTarget
        : "local";

    if (body.runtimeTarget !== undefined && !isValidRuntimeTarget(body.runtimeTarget)) {
      return validationError(
        reply,
        "If provided, 'runtimeTarget' must be one of: 'wsl-devcontainer', 'wsl', 'local'.",
      );
    }

    const owner = body.owner.trim();
    const repo = body.repo.trim();

    if (!isValidOwnerRepo(owner)) {
      return validationError(reply, `Invalid owner: '${owner}'. Must be alphanumeric with hyphens, underscores, or dots.`);
    }
    if (!isValidOwnerRepo(repo)) {
      return validationError(reply, `Invalid repo: '${repo}'. Must be alphanumeric with hyphens, underscores, or dots.`);
    }

    // Duplicate detection
    const config = await fastify.stateService.getConfig();
    const exists = config.projects.some(
      (p) => p.owner.toLowerCase() === owner.toLowerCase() && p.repo.toLowerCase() === repo.toLowerCase(),
    );
    if (exists) {
      return reply.status(409).send({
        error: "duplicate",
        message: `Project ${owner}/${repo} is already tracked.`,
      });
    }

    // Validate repo exists on GitHub
    const repoExists = await repoExistsOnGitHub(fastify.githubToken, owner, repo);
    if (!repoExists) {
      return reply.status(404).send({
        error: "repo_not_found",
        message: `Repository ${owner}/${repo} was not found on GitHub. Check the owner and repo name.`,
      });
    }

    // Add to state
    const daemonToken = (typeof body.daemonToken === 'string' && body.daemonToken.length >= 32)
      ? body.daemonToken
      : generateDaemonToken();
    const entry: ProjectEntry = {
      owner,
      repo,
      addedAt: new Date().toISOString(),
      runtimeTarget,
      initialized: false,
      daemonToken,
      workState: "stopped",
    };
    config.projects.push(entry);
    await fastify.stateService.saveConfig(config);

    // Return full detail including token (only shown once)
    const daemonInfo = deriveDaemonInfo(fastify, owner, repo);
    const response: ProjectDetailResponse = {
      ...toProjectResponse(entry, daemonInfo),
      daemonToken,
    };
    return reply.status(201).send(response);
  });

  // GET /api/projects/:owner/:repo — get single project detail (includes daemonToken)
  fastify.get<{ Params: ProjectParams }>(
    "/api/projects/:owner/:repo",
    async (request, reply) => {
      const { owner, repo } = request.params;

      const config = await fastify.stateService.getConfig();
      const project = config.projects.find(
        (p) => p.owner.toLowerCase() === owner.toLowerCase() && p.repo.toLowerCase() === repo.toLowerCase(),
      );

      if (!project) {
        return reply.status(404).send({
          error: "not_found",
          message: `Project ${owner}/${repo} is not being tracked.`,
        });
      }

      const daemonInfo = deriveDaemonInfo(fastify, project.owner, project.repo);
      const response: ProjectDetailResponse = {
        ...toProjectResponse(project, daemonInfo),
        daemonToken: project.daemonToken,
      };
      return response;
    },
  );

  // DELETE /api/projects/:owner/:repo — remove a project from tracking
  fastify.delete<{ Params: ProjectParams }>(
    "/api/projects/:owner/:repo",
    async (request, reply) => {
      const { owner, repo } = request.params;

      const config = await fastify.stateService.getConfig();
      const idx = config.projects.findIndex(
        (p) => p.owner.toLowerCase() === owner.toLowerCase() && p.repo.toLowerCase() === repo.toLowerCase(),
      );

      if (idx === -1) {
        return reply.status(404).send({
          error: "not_found",
          message: `Project ${owner}/${repo} is not being tracked.`,
        });
      }

      const [removed] = config.projects.splice(idx, 1);
      await fastify.stateService.saveConfig(config);

      // Also clean up enrichment data if present
      try {
        const enrichment = await fastify.stateService.getEnrichment();
        const key = `${owner}/${repo}`;
        if (enrichment.projects[key]) {
          delete enrichment.projects[key];
          await fastify.stateService.saveEnrichment(enrichment);
        }
      } catch {
        // Non-critical: enrichment cleanup failure shouldn't block removal
        fastify.log.warn(`Failed to clean enrichment for ${owner}/${repo}`);
      }

      return reply.status(200).send({ removed });
    },
  );

  // PUT /api/projects/:owner/:repo — update project enrichment config
  fastify.put<{ Params: ProjectParams }>(
    "/api/projects/:owner/:repo",
    async (request, reply) => {
      const { owner, repo } = request.params;
      const body = request.body as UpdateProjectBody | undefined;

      if (!body || (body.labels === undefined && body.enrichment === undefined)) {
        return validationError(reply, "Request body must include at least 'labels' or 'enrichment'.");
      }

      if (body.labels !== undefined && !Array.isArray(body.labels)) {
        return validationError(reply, "'labels' must be an array of strings.");
      }
      if (body.labels && !body.labels.every((l: unknown) => typeof l === "string")) {
        return validationError(reply, "All entries in 'labels' must be strings.");
      }

      // Verify project is tracked
      const config = await fastify.stateService.getConfig();
      const project = config.projects.find(
        (p) => p.owner.toLowerCase() === owner.toLowerCase() && p.repo.toLowerCase() === repo.toLowerCase(),
      );

      if (!project) {
        return reply.status(404).send({
          error: "not_found",
          message: `Project ${owner}/${repo} is not being tracked. Add it first via POST /api/projects.`,
        });
      }

      // Update enrichment data
      const enrichment = await fastify.stateService.getEnrichment();
      const key = `${owner}/${repo}`;
      const existing = enrichment.projects[key] ?? { owner, repo };

      if (body.enrichment?.devcontainerStatus) {
        existing.devcontainerStatus = body.enrichment.devcontainerStatus;
      }
      if (body.enrichment?.sessionLinks) {
        existing.sessionLinks = body.enrichment.sessionLinks;
      }
      existing.lastEnrichedAt = new Date().toISOString();
      enrichment.projects[key] = existing;

      await fastify.stateService.saveEnrichment(enrichment);

      return reply.status(200).send({
        project,
        enrichment: existing,
      });
    },
  );

  // GET /api/discover/repos — list/search repos (optionally filtered by owner and search term)
  fastify.get("/api/discover/repos", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as DiscoverReposQuery;
    const page = Math.max(1, Number(query.page) || 1);
    const perPage = Math.min(10, Math.max(1, Number(query.per_page) || 10));
    const owner = typeof query.owner === "string" ? query.owner.trim() : "";
    const searchTerm = typeof query.q === "string" ? query.q.trim() : "";

    const headers = {
      Authorization: `Bearer ${fastify.githubToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "launchpad-hq",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    let repos: GitHubRepoApiItem[];

    try {
      if (owner || searchTerm) {
        // Use GitHub search API for filtered queries
        const qualifiers: string[] = [];
        if (searchTerm) qualifiers.push(`${searchTerm} in:name`);
        if (owner) qualifiers.push(`user:${owner}`);
        const q = encodeURIComponent(qualifiers.join(" "));

        const response = await fetch(
          `https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=${perPage}&page=${page}`,
          { headers },
        );

        if (!response.ok) {
          return reply.status(502).send({
            error: "github_api_error",
            message: `GitHub API returned ${response.status}.`,
          });
        }

        const data = (await response.json()) as { items: GitHubSearchRepoItem[] };
        repos = data.items;
      } else {
        // Default: list authenticated user's own repos
        const response = await fetch(
          `https://api.github.com/user/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&type=owner`,
          { headers },
        );

        if (!response.ok) {
          return reply.status(502).send({
            error: "github_api_error",
            message: `GitHub API returned ${response.status}.`,
          });
        }

        repos = (await response.json()) as GitHubRepoApiItem[];
      }
    } catch {
      return reply.status(502).send({
        error: "github_api_error",
        message: "Failed to reach GitHub API. Check your network connection.",
      });
    }

    // Mark which repos are already tracked
    const config = await fastify.stateService.getConfig();
    const trackedSet = new Set(
      config.projects.map((p) => `${p.owner.toLowerCase()}/${p.repo.toLowerCase()}`),
    );

    const items = repos.map((r) => ({
      owner: r.owner.login,
      repo: r.name,
      fullName: r.full_name,
      description: r.description,
      url: r.html_url,
      private: r.private,
      language: r.language,
      updatedAt: r.updated_at,
      tracked: trackedSet.has(r.full_name.toLowerCase()),
    }));

    return {
      repos: items,
      page,
      perPage,
    };
  });

  // GET /api/discover/users — search GitHub users and organizations
  fastify.get("/api/discover/users", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as DiscoverUsersQuery;
    const searchTerm = typeof query.q === "string" ? query.q.trim() : "";

    if (!searchTerm) {
      return { users: [] };
    }

    let response: Response;
    try {
      const q = encodeURIComponent(searchTerm);
      response = await fetch(
        `https://api.github.com/search/users?q=${q}&per_page=20`,
        {
          headers: {
            Authorization: `Bearer ${fastify.githubToken}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "launchpad-hq",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
    } catch {
      return reply.status(502).send({
        error: "github_api_error",
        message: "Failed to reach GitHub API. Check your network connection.",
      });
    }

    if (!response.ok) {
      return reply.status(502).send({
        error: "github_api_error",
        message: `GitHub API returned ${response.status}.`,
      });
    }

    const data = (await response.json()) as { items: GitHubUserSearchItem[] };

    const users = data.items.map((u) => ({
      login: u.login,
      type: u.type,
      avatarUrl: u.avatar_url,
    }));

    return { users };
  });
};

export default projectRoutes;
