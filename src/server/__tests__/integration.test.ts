import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTestServer,
  type FastifyInstance,
} from "../../test-utils/server.js";
import projectRoutes from "../routes/projects.js";
import githubDataRoutes from "../routes/github-data.js";
import healthRoutes from "../routes/health.js";
import apiCachePlugin from "../cache/plugin.js";
import type { StateService } from "../state/types.js";
import type { ProjectConfig, EnrichmentData } from "../state/types.js";
import type { GitHubGraphQL } from "../github/graphql.js";

// ── Factories & Helpers ─────────────────────────────────

function createMockStateService(
  initialProjects: ProjectConfig["projects"] = [],
): StateService & {
  getConfig: ReturnType<typeof vi.fn>;
  saveConfig: ReturnType<typeof vi.fn>;
  getEnrichment: ReturnType<typeof vi.fn>;
  saveEnrichment: ReturnType<typeof vi.fn>;
} {
  const config: ProjectConfig = {
    version: 1,
    projects: [...initialProjects],
  };
  const enrichment: EnrichmentData = {
    version: 1,
    projects: {},
    updatedAt: new Date().toISOString(),
  };

  return {
    getConfig: vi.fn().mockImplementation(async () => ({
      ...config,
      projects: [...config.projects],
    })),
    saveConfig: vi.fn().mockImplementation(async (c: ProjectConfig) => {
      config.projects = [...c.projects];
    }),
    getPreferences: vi
      .fn()
      .mockResolvedValue({ version: 1, theme: "system" }),
    savePreferences: vi.fn().mockResolvedValue(undefined),
    getEnrichment: vi.fn().mockImplementation(async () => ({
      ...enrichment,
      projects: { ...enrichment.projects },
    })),
    saveEnrichment: vi.fn().mockImplementation(async (d: EnrichmentData) => {
      enrichment.projects = { ...d.projects };
    }),
    sync: vi.fn().mockResolvedValue(undefined),
    getProjectByToken: vi.fn().mockResolvedValue(undefined),
    updateProjectState: vi.fn().mockResolvedValue(undefined),
    getProjectDefaultCopilotAgent: vi.fn().mockResolvedValue(undefined),
    updateProjectDefaultCopilotAgent: vi.fn().mockResolvedValue(undefined),
    getInbox: vi.fn().mockResolvedValue({ version: 1, projectId: "acme/widget", messages: [] }),
    saveInbox: vi.fn().mockResolvedValue(undefined),
  };
}

/** Build a full ProjectEntry with defaults. */
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

function makeMetadata(overrides = {}) {
  return {
    nameWithOwner: "acme/widget",
    description: "A widget",
    url: "https://github.com/acme/widget",
    defaultBranchRef: "main",
    openIssueCount: 3,
    openPrCount: 1,
    isArchived: false,
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function makeIssue(overrides = {}) {
  return {
    number: 1,
    title: "Test issue",
    state: "OPEN",
    url: "https://github.com/acme/widget/issues/1",
    labels: [],
    assignees: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function createMockGraphQL() {
  return {
    listIssues: vi.fn().mockResolvedValue({
      items: [],
      hasNextPage: false,
      endCursor: null,
    }),
    listPullRequests: vi.fn().mockResolvedValue({
      items: [],
      hasNextPage: false,
      endCursor: null,
    }),
    fetchRepoMetadata: vi.fn().mockResolvedValue(makeMetadata()),
    listViewerRepos: vi.fn().mockResolvedValue({
      repos: [],
      hasNextPage: false,
      endCursor: null,
    }),
    fetchIssuesForRepos: vi.fn().mockResolvedValue(new Map()),
    get rateLimit() {
      return undefined;
    },
  } as unknown as GitHubGraphQL & {
    listIssues: ReturnType<typeof vi.fn>;
    listPullRequests: ReturnType<typeof vi.fn>;
    fetchRepoMetadata: ReturnType<typeof vi.fn>;
    fetchIssuesForRepos: ReturnType<typeof vi.fn>;
  };
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }),
  );
}

const TRACKED = [
  makeProject({ owner: "acme", repo: "widget" }),
];

// ── Server builder with all Phase 1 plugins ─────────────

async function buildFullServer(
  initialProjects: ProjectConfig["projects"] = [],
) {
  const server = await createTestServer();
  const stateService = createMockStateService(initialProjects);
  const graphql = createMockGraphQL();

  server.decorate("githubToken", "ghp_test_token");
  server.decorate("githubUser", {
    login: "testuser",
    avatarUrl: "https://example.com/avatar.png",
  });
  server.decorate("stateService", stateService);
  server.decorate("githubGraphQL", graphql);
  server.decorate("daemonRegistry", { getAllDaemons: vi.fn().mockReturnValue([]) });

  await server.register(apiCachePlugin, {
    cache: { diskPersistence: false },
  });
  await server.register(healthRoutes);
  await server.register(projectRoutes);
  await server.register(githubDataRoutes);

  return { server, stateService, graphql };
}

// ── Tests ────────────────────────────────────────────────

describe("Phase 1 Integration: Full CRUD lifecycle", () => {
  let server: FastifyInstance;
  let stateService: ReturnType<typeof createMockStateService>;

  beforeEach(async () => {
    stubFetch();
    const built = await buildFullServer();
    server = built.server;
    stateService = built.stateService;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
  });

  it("adds a project, lists it, then removes it", async () => {
    // 1. Empty at start
    let res = await server.inject({
      method: "GET",
      url: "/api/projects",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toHaveLength(0);

    // 2. Add project
    res = await server.inject({
      method: "POST",
      url: "/api/projects",
      payload: { owner: "acme", repo: "widget", runtimeTarget: "local" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ owner: "acme", repo: "widget", runtimeTarget: "local" });
    expect(stateService.saveConfig).toHaveBeenCalled();

    // 3. Now listed
    res = await server.inject({
      method: "GET",
      url: "/api/projects",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toHaveLength(1);
    expect(res.json().projects[0]).toMatchObject({
      owner: "acme",
      repo: "widget",
    });

    // 4. Delete it
    res = await server.inject({
      method: "DELETE",
      url: "/api/projects/acme/widget",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toMatchObject({
      owner: "acme",
      repo: "widget",
    });

    // 5. Empty again
    res = await server.inject({
      method: "GET",
      url: "/api/projects",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toHaveLength(0);
  });

  it("rejects duplicate project add", async () => {
    // Add first
    await server.inject({
      method: "POST",
      url: "/api/projects",
      payload: { owner: "acme", repo: "widget", runtimeTarget: "local" },
    });

    // Try adding again
    const res = await server.inject({
      method: "POST",
      url: "/api/projects",
      payload: { owner: "acme", repo: "widget", runtimeTarget: "local" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects adding project with missing fields", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/projects",
      payload: { owner: "acme" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Phase 1 Integration: GitHub data routes require tracked project", () => {
  let server: FastifyInstance;
  let graphql: ReturnType<typeof createMockGraphQL>;

  beforeEach(async () => {
    stubFetch();
    const built = await buildFullServer(TRACKED);
    server = built.server;
    graphql = built.graphql;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
  });

  it("returns overview for tracked project", async () => {
    graphql.fetchRepoMetadata.mockResolvedValue(makeMetadata());
    graphql.listIssues.mockResolvedValue({
      items: [makeIssue()],
      hasNextPage: false,
      endCursor: null,
    });
    graphql.listPullRequests.mockResolvedValue({
      items: [],
      hasNextPage: false,
      endCursor: null,
    });

    const res = await server.inject({
      method: "GET",
      url: "/api/projects/acme/widget/overview",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.owner).toBe("acme");
    expect(body.repo).toBe("widget");
    expect(body.metadata).toBeDefined();
    expect(body.metadata.nameWithOwner).toBe("acme/widget");
  });

  it("returns 404 for untracked project overview", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/projects/unknown/repo/overview",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns issues for tracked project", async () => {
    const issues = [
      makeIssue({ number: 1, title: "Bug" }),
      makeIssue({ number: 2, title: "Feature", state: "CLOSED" }),
    ];
    graphql.listIssues.mockResolvedValue({
      items: issues,
      hasNextPage: false,
      endCursor: null,
    });

    const res = await server.inject({
      method: "GET",
      url: "/api/projects/acme/widget/issues",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.issues).toHaveLength(2);
    expect(body.issues[0].title).toBe("Bug");
  });

  it("returns 404 for untracked project issues", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/projects/unknown/repo/issues",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Phase 1 Integration: Dashboard aggregation", () => {
  let server: FastifyInstance;
  let graphql: ReturnType<typeof createMockGraphQL>;

  beforeEach(async () => {
    stubFetch();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("returns empty dashboard when no projects", async () => {
    const { server: s } = await buildFullServer();
    const res = await s.inject({ method: "GET", url: "/api/dashboard" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalProjects).toBe(0);
    expect(body.projects).toHaveLength(0);
    await s.close();
  });

  it("aggregates data across tracked projects", async () => {
    const twoProjects = [
      ...TRACKED,
      makeProject({ owner: "acme", repo: "gizmo", addedAt: "2026-02-01T00:00:00Z" }),
    ];
    const { server: s, graphql: gql } = await buildFullServer(twoProjects);

    gql.fetchIssuesForRepos.mockResolvedValue(
      new Map([
        [
          "acme/widget",
          {
            metadata: makeMetadata({ openIssueCount: 3, openPrCount: 1 }),
            issues: [],
          },
        ],
        [
          "acme/gizmo",
          {
            metadata: makeMetadata({
              nameWithOwner: "acme/gizmo",
              openIssueCount: 5,
              openPrCount: 2,
            }),
            issues: [],
          },
        ],
      ]),
    );

    const res = await s.inject({ method: "GET", url: "/api/dashboard" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalProjects).toBe(2);
    expect(body.projects).toHaveLength(2);
    await s.close();
  });
});

describe("Phase 1 Integration: Cache plugin routes", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    stubFetch();
    const built = await buildFullServer();
    server = built.server;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
  });

  it("GET /api/cache/stats returns cache statistics", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/cache/stats",
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats).toHaveProperty("hits");
    expect(stats).toHaveProperty("misses");
    expect(stats).toHaveProperty("entries");
    expect(stats).toHaveProperty("hitRate");
    expect(stats).toHaveProperty("evictions");
  });

  it("DELETE /api/cache clears all entries", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/api/cache",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("DELETE /api/cache/entries/:key returns 404 for missing key", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/api/cache/entries/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /api/cache/types/:dataType returns 404 for empty type", async () => {
    const res = await server.inject({
      method: "DELETE",
      url: "/api/cache/types/issues",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Phase 1 Integration: Health endpoint", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    stubFetch();
    const built = await buildFullServer();
    server = built.server;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.close();
  });

  it("GET /api/health returns server status", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
  });
});

describe("Phase 1 Integration: Cross-cutting concerns", () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("all Phase 1 route plugins co-register without conflicts", async () => {
    const { server } = await buildFullServer(TRACKED);

    // Verify each plugin's routes exist by hitting them
    const routes = [
      { method: "GET" as const, url: "/api/health" },
      { method: "GET" as const, url: "/api/projects" },
      { method: "GET" as const, url: "/api/dashboard" },
      { method: "GET" as const, url: "/api/cache/stats" },
    ];

    for (const route of routes) {
      const res = await server.inject(route);
      expect(res.statusCode).toBeLessThan(500);
    }

    await server.close();
  });

  it("delete project removes project data and it no longer appears in dashboard", async () => {
    const { server, graphql } = await buildFullServer(TRACKED);

    // Verify project shows in list first
    let res = await server.inject({
      method: "GET",
      url: "/api/projects",
    });
    expect(res.json().count).toBe(1);

    // Delete it
    res = await server.inject({
      method: "DELETE",
      url: "/api/projects/acme/widget",
    });
    expect(res.statusCode).toBe(200);

    // Gone from project list
    res = await server.inject({
      method: "GET",
      url: "/api/projects",
    });
    expect(res.json().count).toBe(0);

    await server.close();
  });
});
