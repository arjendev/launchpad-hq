import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTestServer,
  type FastifyInstance,
} from "../../test-utils/server.js";
import { AttentionManager } from "../attention/manager.js";
import {
  evaluateStaleIssues,
  evaluatePrNeedsReview,
  evaluateCiFailing,
  evaluateSessionIdle,
  evaluateRules,
  itemId,
} from "../attention/rules.js";
import attentionPlugin from "../attention/plugin.js";
import type { GitHubIssue, GitHubPullRequest } from "../github/graphql-types.js";
import type { AttentionItem, AttentionRuleConfig } from "../attention/types.js";
import { defaultAttentionConfig } from "../attention/types.js";
import type { StateService, ProjectConfig } from "../state/types.js";

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

function makeAttentionItem(
  overrides: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    id: "attn_test123",
    type: "issue_stale",
    severity: "warning",
    project: "acme/api",
    message: "Test attention item",
    createdAt: "2026-03-01T00:00:00Z",
    dismissed: false,
    ...overrides,
  };
}

// ── Rule engine tests ───────────────────────────────────

describe("attention rules", () => {
  const now = new Date("2026-03-15T00:00:00Z");
  const project = "acme/api";

  describe("evaluateStaleIssues", () => {
    it("flags issues with no activity beyond staleDays", () => {
      const issues = [
        makeIssue({ number: 1, updatedAt: "2026-02-01T00:00:00Z" }), // 42 days old
        makeIssue({ number: 2, updatedAt: "2026-03-14T00:00:00Z" }), // 1 day old
      ];
      const items = evaluateStaleIssues(project, issues, 14, now);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("issue_stale");
      expect(items[0].sourceId).toBe("1");
      expect(items[0].severity).toBe("critical"); // 42 > 28 (14*2)
    });

    it("uses warning severity for moderately stale issues", () => {
      const issues = [
        makeIssue({ number: 3, updatedAt: "2026-02-25T00:00:00Z" }), // 18 days
      ];
      const items = evaluateStaleIssues(project, issues, 14, now);
      expect(items).toHaveLength(1);
      expect(items[0].severity).toBe("warning");
    });

    it("skips closed issues", () => {
      const issues = [
        makeIssue({
          number: 4,
          state: "CLOSED",
          updatedAt: "2026-01-01T00:00:00Z",
        }),
      ];
      const items = evaluateStaleIssues(project, issues, 14, now);
      expect(items).toHaveLength(0);
    });

    it("returns empty for fresh issues", () => {
      const issues = [
        makeIssue({ number: 5, updatedAt: "2026-03-14T00:00:00Z" }),
      ];
      const items = evaluateStaleIssues(project, issues, 14, now);
      expect(items).toHaveLength(0);
    });

    it("generates deterministic IDs", () => {
      const issues = [
        makeIssue({ number: 1, updatedAt: "2026-01-01T00:00:00Z" }),
      ];
      const items1 = evaluateStaleIssues(project, issues, 14, now);
      const items2 = evaluateStaleIssues(project, issues, 14, now);
      expect(items1[0].id).toBe(items2[0].id);
    });
  });

  describe("evaluatePrNeedsReview", () => {
    it("flags open non-draft PRs", () => {
      const prs = [
        makePR({ number: 10 }),
        makePR({ number: 11, isDraft: true }),
      ];
      const items = evaluatePrNeedsReview(project, prs);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("pr_needs_review");
      expect(items[0].sourceId).toBe("10");
    });

    it("skips closed PRs", () => {
      const prs = [makePR({ number: 12, state: "CLOSED" })];
      const items = evaluatePrNeedsReview(project, prs);
      expect(items).toHaveLength(0);
    });

    it("skips draft PRs", () => {
      const prs = [makePR({ number: 13, isDraft: true })];
      const items = evaluatePrNeedsReview(project, prs);
      expect(items).toHaveLength(0);
    });
  });

  describe("evaluateCiFailing", () => {
    it("returns empty (stub until checks API)", () => {
      const prs = [makePR()];
      const items = evaluateCiFailing(project, prs);
      expect(items).toHaveLength(0);
    });
  });

  describe("evaluateSessionIdle", () => {
    it("returns empty (stub until Copilot SDK)", () => {
      const items = evaluateSessionIdle(project, { idleMinutes: 5 });
      expect(items).toHaveLength(0);
    });
  });

  describe("evaluateRules", () => {
    it("runs all enabled rules", () => {
      const rules = defaultAttentionConfig().rules;
      const context = {
        project,
        issues: [
          makeIssue({ number: 1, updatedAt: "2026-01-01T00:00:00Z" }),
        ],
        pullRequests: [makePR({ number: 10 })],
      };
      const items = evaluateRules(rules, context);
      // 1 stale issue + 1 PR needs review
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.map((i) => i.type)).toContain("issue_stale");
      expect(items.map((i) => i.type)).toContain("pr_needs_review");
    });

    it("skips disabled rules", () => {
      const rules: AttentionRuleConfig[] = [
        { type: "issue_stale", enabled: false, params: { staleDays: 14 } },
        { type: "pr_needs_review", enabled: true, params: {} },
      ];
      const context = {
        project,
        issues: [
          makeIssue({ number: 1, updatedAt: "2026-01-01T00:00:00Z" }),
        ],
        pullRequests: [makePR({ number: 10 })],
      };
      const items = evaluateRules(rules, context);
      expect(items.every((i) => i.type !== "issue_stale")).toBe(true);
      expect(items.some((i) => i.type === "pr_needs_review")).toBe(true);
    });
  });

  describe("itemId", () => {
    it("is deterministic", () => {
      const a = itemId("issue_stale", "acme/api", "1");
      const b = itemId("issue_stale", "acme/api", "1");
      expect(a).toBe(b);
    });

    it("differs for different inputs", () => {
      const a = itemId("issue_stale", "acme/api", "1");
      const b = itemId("issue_stale", "acme/api", "2");
      expect(a).not.toBe(b);
    });
  });
});

// ── AttentionManager tests ──────────────────────────────

describe("AttentionManager", () => {
  let manager: AttentionManager;

  beforeEach(() => {
    manager = new AttentionManager({ maxItems: 10 });
  });

  it("stores and retrieves items", () => {
    const item = makeAttentionItem();
    manager.addItem(item);
    expect(manager.get(item.id)).toEqual(item);
  });

  it("lists items sorted by severity then date", () => {
    manager.addItem(
      makeAttentionItem({
        id: "a",
        severity: "info",
        createdAt: "2026-03-01T00:00:00Z",
      }),
    );
    manager.addItem(
      makeAttentionItem({
        id: "b",
        severity: "critical",
        createdAt: "2026-03-02T00:00:00Z",
      }),
    );
    manager.addItem(
      makeAttentionItem({
        id: "c",
        severity: "warning",
        createdAt: "2026-03-03T00:00:00Z",
      }),
    );

    const items = manager.list();
    expect(items[0].id).toBe("b"); // critical
    expect(items[1].id).toBe("c"); // warning
    expect(items[2].id).toBe("a"); // info
  });

  it("filters by severity", () => {
    manager.addItem(makeAttentionItem({ id: "a", severity: "critical" }));
    manager.addItem(makeAttentionItem({ id: "b", severity: "warning" }));

    const items = manager.list({ severity: "critical" });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("a");
  });

  it("filters by project", () => {
    manager.addItem(makeAttentionItem({ id: "a", project: "acme/api" }));
    manager.addItem(makeAttentionItem({ id: "b", project: "acme/web" }));

    const items = manager.list({ project: "acme/web" });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b");
  });

  it("filters by type", () => {
    manager.addItem(makeAttentionItem({ id: "a", type: "issue_stale" }));
    manager.addItem(makeAttentionItem({ id: "b", type: "pr_needs_review" }));

    const items = manager.list({ type: "pr_needs_review" });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b");
  });

  it("filters by dismissed state", () => {
    manager.addItem(makeAttentionItem({ id: "a", dismissed: false }));
    manager.addItem(makeAttentionItem({ id: "b", dismissed: true }));

    const undismissed = manager.list({ dismissed: false });
    expect(undismissed).toHaveLength(1);
    expect(undismissed[0].id).toBe("a");
  });

  it("dismisses an item", () => {
    manager.addItem(makeAttentionItem({ id: "a", dismissed: false }));
    expect(manager.dismiss("a")).toBe(true);
    expect(manager.get("a")?.dismissed).toBe(true);
  });

  it("returns false when dismissing non-existent item", () => {
    expect(manager.dismiss("nonexistent")).toBe(false);
  });

  it("counts unread items", () => {
    manager.addItem(makeAttentionItem({ id: "a", dismissed: false }));
    manager.addItem(makeAttentionItem({ id: "b", dismissed: true }));
    manager.addItem(
      makeAttentionItem({ id: "c", dismissed: false, severity: "critical" }),
    );

    expect(manager.unreadCount()).toBe(2);
  });

  it("counts unread by severity", () => {
    manager.addItem(
      makeAttentionItem({
        id: "a",
        dismissed: false,
        severity: "critical",
      }),
    );
    manager.addItem(
      makeAttentionItem({
        id: "b",
        dismissed: false,
        severity: "warning",
      }),
    );
    manager.addItem(
      makeAttentionItem({ id: "c", dismissed: true, severity: "critical" }),
    );

    const counts = manager.unreadCountBySeverity();
    expect(counts.critical).toBe(1);
    expect(counts.warning).toBe(1);
    expect(counts.info).toBe(0);
  });

  it("enforces maxItems limit", () => {
    const mgr = new AttentionManager({ maxItems: 3 });
    for (let i = 0; i < 5; i++) {
      mgr.addItem(
        makeAttentionItem({
          id: `item-${i}`,
          createdAt: new Date(2026, 2, i + 1).toISOString(),
        }),
      );
    }
    expect(mgr.list().length).toBeLessThanOrEqual(3);
  });

  it("clears all items", () => {
    manager.addItem(makeAttentionItem({ id: "a" }));
    manager.addItem(makeAttentionItem({ id: "b" }));
    manager.clear();
    expect(manager.list()).toHaveLength(0);
  });

  it("start/stop evaluation loop without deps is safe", () => {
    // Without calling init(), runEvaluation should be a no-op
    manager.start();
    manager.stop();
    expect(manager.list()).toHaveLength(0);
  });
});

// ── REST endpoint tests ─────────────────────────────────

describe("attention REST endpoints", () => {
  let server: FastifyInstance;
  let manager: AttentionManager;

  beforeEach(async () => {
    server = await createTestServer();

    // Decorate with mocks that the attention plugin depends on
    server.decorate("ws", {
      broadcast: vi.fn(),
      clients: () => 0,
    });
    server.decorate("githubGraphQL", {} as any);
    server.decorate("stateService", {
      getConfig: vi.fn().mockResolvedValue({ version: 1, projects: [] }),
    } as unknown as StateService);

    // Register with evaluation disabled (we test routes, not the loop)
    await server.register(attentionPlugin, {
      config: { evaluationIntervalMs: 999_999_999 },
    });

    await server.ready();

    manager = server.attention;

    // Seed test data
    manager.addItem(
      makeAttentionItem({
        id: "item-1",
        severity: "critical",
        project: "acme/api",
        type: "issue_stale",
      }),
    );
    manager.addItem(
      makeAttentionItem({
        id: "item-2",
        severity: "warning",
        project: "acme/web",
        type: "pr_needs_review",
      }),
    );
    manager.addItem(
      makeAttentionItem({ id: "item-3", dismissed: true, severity: "info" }),
    );
  });

  describe("GET /api/attention", () => {
    it("returns all items", async () => {
      const res = await server.inject({ method: "GET", url: "/api/attention" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(3);
    });

    it("filters by severity", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/attention?severity=critical",
      });
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe("item-1");
    });

    it("filters by project", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/attention?project=acme/web",
      });
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe("item-2");
    });

    it("filters by type", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/attention?type=pr_needs_review",
      });
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe("item-2");
    });

    it("filters by dismissed state", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/attention?dismissed=false",
      });
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.items.every((i: any) => !i.dismissed)).toBe(true);
    });
  });

  describe("GET /api/attention/count", () => {
    it("returns unread count and breakdown", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/attention/count",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(2); // item-3 is dismissed
      expect(body.bySeverity.critical).toBe(1);
      expect(body.bySeverity.warning).toBe(1);
    });
  });

  describe("POST /api/attention/:id/dismiss", () => {
    it("dismisses an existing item", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/attention/item-1/dismiss",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.unreadCount).toBe(1); // only item-2 left
    });

    it("returns 404 for unknown item", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/api/attention/nonexistent/dismiss",
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe("NOT_FOUND");
    });
  });
});
