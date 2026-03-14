import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestServer, type FastifyInstance } from "../../test-utils/server.js";
import projectRoutes from "../routes/projects.js";
import type { StateService } from "../state/types.js";
import type { ProjectConfig, ProjectEntry, EnrichmentData } from "../state/types.js";

// ---- Helpers ----------------------------------------------------------------

/** Build a full ProjectEntry with sensible defaults. */
function makeProject(overrides: Partial<ProjectEntry> & Pick<ProjectEntry, "owner" | "repo">): ProjectEntry {
  return {
    addedAt: "2026-01-01T00:00:00Z",
    runtimeTarget: "local",
    initialized: false,
    daemonToken: "test-token-" + overrides.owner + "-" + overrides.repo,
    workState: "stopped",
    ...overrides,
  };
}

/** Build a mock StateService with sensible defaults. */
function createMockStateService(initialProjects: ProjectConfig["projects"] = []): StateService & {
  getConfig: ReturnType<typeof vi.fn>;
  saveConfig: ReturnType<typeof vi.fn>;
  getEnrichment: ReturnType<typeof vi.fn>;
  saveEnrichment: ReturnType<typeof vi.fn>;
} {
  const config: ProjectConfig = { version: 1, projects: [...initialProjects] };
  const enrichment: EnrichmentData = { version: 1, projects: {}, updatedAt: new Date().toISOString() };

  return {
    getConfig: vi.fn().mockImplementation(async () => ({ ...config, projects: [...config.projects] })),
    saveConfig: vi.fn().mockImplementation(async (c: ProjectConfig) => {
      config.projects = [...c.projects];
    }),
    getPreferences: vi.fn().mockResolvedValue({ version: 1, theme: "system" }),
    savePreferences: vi.fn().mockResolvedValue(undefined),
    getEnrichment: vi.fn().mockImplementation(async () => ({
      ...enrichment,
      projects: { ...enrichment.projects },
    })),
    saveEnrichment: vi.fn().mockImplementation(async (d: EnrichmentData) => {
      enrichment.projects = { ...d.projects };
    }),
    sync: vi.fn().mockResolvedValue(undefined),
    getProjectByToken: vi.fn().mockImplementation(async (token: string) => {
      return config.projects.find((p) => p.daemonToken === token);
    }),
    updateProjectState: vi.fn().mockResolvedValue(undefined),
    getProjectDefaultCopilotAgent: vi.fn().mockResolvedValue(undefined),
    updateProjectDefaultCopilotAgent: vi.fn().mockResolvedValue(undefined),
    getInbox: vi.fn().mockResolvedValue({ version: 1, projectId: "acme/widget", messages: [] }),
    saveInbox: vi.fn().mockResolvedValue(undefined),
  };
}

/** Mock daemon registry for testing daemon status derivation. */
function createMockDaemonRegistry(connectedProjects: string[] = []) {
  return {
    getAllDaemons: vi.fn().mockReturnValue(
      connectedProjects.map((pid) => ({
        projectId: pid,
        state: "connected",
        lastHeartbeat: Date.now(),
      })),
    ),
  };
}

/** Stub global fetch for repo-existence checks and discovery. */
function stubFetch(overrides: Record<string, { ok: boolean; status: number; json?: unknown }> = {}) {
  const impl = vi.fn().mockImplementation(async (url: string | URL) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    for (const [pattern, response] of Object.entries(overrides)) {
      if (urlStr.includes(pattern)) {
        return {
          ok: response.ok,
          status: response.status,
          json: async () => response.json ?? {},
        };
      }
    }
    // Default: repo exists
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

/** Create a Fastify instance decorated with stateService & githubToken for testing. */
async function buildServer(
  initialProjects: ProjectConfig["projects"] = [],
  connectedDaemons: string[] = [],
): Promise<{ server: FastifyInstance; stateService: ReturnType<typeof createMockStateService> }> {
  const server = await createTestServer();
  const stateService = createMockStateService(initialProjects);

  server.decorate("githubToken", "ghp_test_token");
  server.decorate("githubUser", { login: "testuser", avatarUrl: "https://example.com/avatar" });
  server.decorate("stateService", stateService);
  server.decorate("daemonRegistry", createMockDaemonRegistry(connectedDaemons));
  await server.register(projectRoutes);

  return { server, stateService };
}

// ---- Tests ------------------------------------------------------------------

describe("Project routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---- GET /api/projects ----------------------------------------------------

  describe("GET /api/projects", () => {
    it("returns empty list when no projects tracked", async () => {
      const { server } = await buildServer();
      const res = await server.inject({ method: "GET", url: "/api/projects" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.projects).toEqual([]);
      expect(body.count).toBe(0);
    });

    it("returns tracked projects", async () => {
      const projects = [
        makeProject({ owner: "acme", repo: "api", addedAt: "2026-01-01T00:00:00Z" }),
        makeProject({ owner: "acme", repo: "ui", addedAt: "2026-02-01T00:00:00Z" }),
      ];
      const { server } = await buildServer(projects);
      const res = await server.inject({ method: "GET", url: "/api/projects" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(2);
      expect(body.projects[0].owner).toBe("acme");
    });
  });

  // ---- POST /api/projects ---------------------------------------------------

  describe("POST /api/projects", () => {
    it("adds a new project when repo exists on GitHub", async () => {
      stubFetch({ "/repos/acme/widget": { ok: true, status: 200 } });
      const { server, stateService } = await buildServer();

      const res = await server.inject({
        method: "POST",
        url: "/api/projects",
        payload: { owner: "acme", repo: "widget", runtimeTarget: "local" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.owner).toBe("acme");
      expect(body.repo).toBe("widget");
      expect(body.addedAt).toBeDefined();
      expect(body.runtimeTarget).toBe("local");
      expect(body.initialized).toBe(false);
      expect(body.workState).toBe("stopped");
      expect(body.daemonToken).toBeDefined();
      expect(typeof body.daemonToken).toBe("string");
      expect(body.daemonToken.length).toBeGreaterThan(0);
      expect(body.daemonStatus).toBe("offline");
      expect(stateService.saveConfig).toHaveBeenCalledOnce();
    });

    it("rejects missing runtimeTarget", async () => {
      stubFetch();
      const { server } = await buildServer();

      const res = await server.inject({
        method: "POST",
        url: "/api/projects",
        payload: { owner: "acme", repo: "widget" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("runtimeTarget");
    });

    it("rejects invalid runtimeTarget value", async () => {
      stubFetch();
      const { server } = await buildServer();

      const res = await server.inject({
        method: "POST",
        url: "/api/projects",
        payload: { owner: "acme", repo: "widget", runtimeTarget: "docker" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("runtimeTarget");
    });

    it("rejects missing body fields", async () => {
      const { server } = await buildServer();
      const res = await server.inject({
        method: "POST",
        url: "/api/projects",
        payload: { owner: "acme" }, // missing repo and runtimeTarget
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("validation_error");
    });

    it("rejects invalid owner format", async () => {
      const { server } = await buildServer();
      const res = await server.inject({
        method: "POST",
        url: "/api/projects",
        payload: { owner: "acme/evil", repo: "widget", runtimeTarget: "local" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("detects duplicates (case-insensitive)", async () => {
      stubFetch();
      const { server } = await buildServer([
        makeProject({ owner: "Acme", repo: "Widget" }),
      ]);

      const res = await server.inject({
        method: "POST",
        url: "/api/projects",
        payload: { owner: "acme", repo: "widget", runtimeTarget: "local" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("duplicate");
    });

    it("returns 404 when repo does not exist on GitHub", async () => {
      stubFetch({ "/repos/acme/nonexistent": { ok: false, status: 404 } });
      const { server } = await buildServer();

      const res = await server.inject({
        method: "POST",
        url: "/api/projects",
        payload: { owner: "acme", repo: "nonexistent", runtimeTarget: "local" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("repo_not_found");
    });
  });

  // ---- DELETE /api/projects/:owner/:repo ------------------------------------

  describe("DELETE /api/projects/:owner/:repo", () => {
    it("removes a tracked project", async () => {
      const { server, stateService } = await buildServer([
        makeProject({ owner: "acme", repo: "api" }),
      ]);

      const res = await server.inject({
        method: "DELETE",
        url: "/api/projects/acme/api",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().removed.owner).toBe("acme");
      expect(stateService.saveConfig).toHaveBeenCalledOnce();
    });

    it("returns 404 for untracked project", async () => {
      const { server } = await buildServer();

      const res = await server.inject({
        method: "DELETE",
        url: "/api/projects/acme/nope",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });
  });

  // ---- PUT /api/projects/:owner/:repo ---------------------------------------

  describe("PUT /api/projects/:owner/:repo", () => {
    it("updates enrichment data for a tracked project", async () => {
      const { server, stateService } = await buildServer([
        makeProject({ owner: "acme", repo: "api" }),
      ]);

      const res = await server.inject({
        method: "PUT",
        url: "/api/projects/acme/api",
        payload: {
          enrichment: { devcontainerStatus: "active" },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.enrichment.devcontainerStatus).toBe("active");
      expect(stateService.saveEnrichment).toHaveBeenCalledOnce();
    });

    it("returns 404 for untracked project", async () => {
      const { server } = await buildServer();

      const res = await server.inject({
        method: "PUT",
        url: "/api/projects/acme/nope",
        payload: { labels: ["bug"] },
      });

      expect(res.statusCode).toBe(404);
    });

    it("rejects empty body", async () => {
      const { server } = await buildServer([
        makeProject({ owner: "acme", repo: "api" }),
      ]);

      const res = await server.inject({
        method: "PUT",
        url: "/api/projects/acme/api",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects non-array labels", async () => {
      const { server } = await buildServer([
        makeProject({ owner: "acme", repo: "api" }),
      ]);

      const res = await server.inject({
        method: "PUT",
        url: "/api/projects/acme/api",
        payload: { labels: "not-an-array" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ---- GET /api/discover/repos ----------------------------------------------

  describe("GET /api/discover/repos", () => {
    it("returns user repos with tracking status", async () => {
      const repos = [
        {
          full_name: "testuser/my-app",
          owner: { login: "testuser" },
          name: "my-app",
          description: "An app",
          html_url: "https://github.com/testuser/my-app",
          private: false,
          language: "TypeScript",
          updated_at: "2026-03-01T00:00:00Z",
        },
      ];
      stubFetch({ "/user/repos": { ok: true, status: 200, json: repos } });

      const { server } = await buildServer([
        makeProject({ owner: "testuser", repo: "my-app" }),
      ]);

      const res = await server.inject({
        method: "GET",
        url: "/api/discover/repos",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.repos).toHaveLength(1);
      expect(body.repos[0].tracked).toBe(true);
      expect(body.repos[0].owner).toBe("testuser");
    });

    it("handles GitHub API failure", async () => {
      stubFetch({ "/user/repos": { ok: false, status: 500 } });
      const { server } = await buildServer();

      const res = await server.inject({
        method: "GET",
        url: "/api/discover/repos",
      });

      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe("github_api_error");
    });

    it("supports pagination parameters", async () => {
      const fetchMock = stubFetch({ "/user/repos": { ok: true, status: 200, json: [] } });
      const { server } = await buildServer();

      const res = await server.inject({
        method: "GET",
        url: "/api/discover/repos?page=2&per_page=10",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.page).toBe(2);
      expect(body.perPage).toBe(10);
      // Verify fetch was called with correct pagination
      const fetchUrl = fetchMock.mock.calls[0][0] as string;
      expect(fetchUrl).toContain("page=2");
      expect(fetchUrl).toContain("per_page=10");
    });
  });

  // ---- GET /api/projects/:owner/:repo (detail) ------------------------------

  describe("GET /api/projects/:owner/:repo", () => {
    it("returns project detail with daemonToken", async () => {
      const { server } = await buildServer([
        makeProject({ owner: "acme", repo: "api", runtimeTarget: "wsl", daemonToken: "secret-token-123" }),
      ]);

      const res = await server.inject({
        method: "GET",
        url: "/api/projects/acme/api",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.owner).toBe("acme");
      expect(body.repo).toBe("api");
      expect(body.runtimeTarget).toBe("wsl");
      expect(body.daemonToken).toBe("secret-token-123");
      expect(body.daemonStatus).toBe("offline");
      expect(body.initialized).toBe(false);
      expect(body.workState).toBe("stopped");
    });

    it("returns 404 for untracked project", async () => {
      const { server } = await buildServer();

      const res = await server.inject({
        method: "GET",
        url: "/api/projects/acme/nope",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("not_found");
    });

    it("derives online daemonStatus from registry", async () => {
      const { server } = await buildServer(
        [makeProject({ owner: "acme", repo: "api" })],
        ["acme/api"],
      );

      const res = await server.inject({
        method: "GET",
        url: "/api/projects/acme/api",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.daemonStatus).toBe("online");
      expect(body.lastSeen).toBeDefined();
    });
  });

  // ---- daemonToken security -------------------------------------------------

  describe("daemonToken security", () => {
    it("does not include daemonToken in list response", async () => {
      const { server } = await buildServer([
        makeProject({ owner: "acme", repo: "api", daemonToken: "secret-token" }),
      ]);

      const res = await server.inject({ method: "GET", url: "/api/projects" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.projects[0].daemonToken).toBeUndefined();
    });
  });
});
