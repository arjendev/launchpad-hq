import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CacheManager, buildCacheKey } from "../cache-manager.js";
import type { CacheDataType } from "../types.js";

// ── buildCacheKey ───────────────────────────────────────

describe("buildCacheKey", () => {
  it("returns dataType alone when no params", () => {
    expect(buildCacheKey("issues")).toBe("issues");
  });

  it("sorts params alphabetically", () => {
    const key = buildCacheKey("issues", { repo: "myrepo", owner: "me" });
    expect(key).toBe("issues:owner=me&repo=myrepo");
  });

  it("omits undefined/null params", () => {
    const key = buildCacheKey("pullRequests", {
      owner: "me",
      after: undefined,
      states: null,
    });
    expect(key).toBe("pullRequests:owner=me");
  });

  it("stringifies non-string values", () => {
    const key = buildCacheKey("repoMetadata", { first: 30, archived: false });
    expect(key).toBe("repoMetadata:archived=false&first=30");
  });
});

// ── CacheManager ────────────────────────────────────────

describe("CacheManager", () => {
  let cache: CacheManager;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new CacheManager({ ttl: { issues: 2, pullRequests: 2, repoMetadata: 5, viewerRepos: 5, batchIssues: 2 } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Basic get/set ─────────────────────────────────

  it("returns undefined for unknown key (miss)", () => {
    expect(cache.get("nope")).toBeUndefined();
    expect(cache.stats.misses).toBe(1);
  });

  it("stores and retrieves a value (hit)", () => {
    cache.set("k1", "issues", { id: 1 });
    expect(cache.get("k1")).toEqual({ id: 1 });
    expect(cache.stats.hits).toBe(1);
    expect(cache.stats.misses).toBe(0);
  });

  it("returns undefined after TTL expires", () => {
    cache.set("k1", "issues", "hello");
    vi.advanceTimersByTime(3_000); // TTL = 2s → expired
    expect(cache.get("k1")).toBeUndefined();
    expect(cache.stats.misses).toBe(1);
  });

  it("returns value just before TTL expires", () => {
    cache.set("k1", "issues", "hello");
    vi.advanceTimersByTime(1_999);
    expect(cache.get("k1")).toBe("hello");
    expect(cache.stats.hits).toBe(1);
  });

  it("uses per-type TTL", () => {
    cache.set("i1", "issues", "issue");
    cache.set("r1", "repoMetadata", "repo");

    vi.advanceTimersByTime(3_000); // 3s: issues (2s) expired, repoMetadata (5s) still alive
    expect(cache.get("i1")).toBeUndefined();
    expect(cache.get("r1")).toBe("repo");
  });

  // ── getOrFetch ────────────────────────────────────

  it("returns cached value without calling fetcher", async () => {
    cache.set("k1", "issues", [1, 2, 3]);
    const fetcher = vi.fn().mockResolvedValue([4, 5, 6]);

    const result = await cache.getOrFetch("k1", "issues", fetcher);
    expect(result).toEqual([1, 2, 3]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("calls fetcher on miss and stores result", async () => {
    const fetcher = vi.fn().mockResolvedValue([4, 5, 6]);

    const result = await cache.getOrFetch("k2", "issues", fetcher);
    expect(result).toEqual([4, 5, 6]);
    expect(fetcher).toHaveBeenCalledOnce();
    // Subsequent get is a hit
    expect(cache.get("k2")).toEqual([4, 5, 6]);
  });

  // ── Invalidation ──────────────────────────────────

  it("invalidate removes a specific key", () => {
    cache.set("k1", "issues", "a");
    expect(cache.invalidate("k1")).toBe(true);
    expect(cache.get("k1")).toBeUndefined();
  });

  it("invalidate returns false for non-existent key", () => {
    expect(cache.invalidate("nope")).toBe(false);
  });

  it("invalidateByType removes all entries of that type", () => {
    cache.set("i1", "issues", "a");
    cache.set("i2", "issues", "b");
    cache.set("r1", "repoMetadata", "c");

    const removed = cache.invalidateByType("issues");
    expect(removed).toBe(2);
    expect(cache.get("i1")).toBeUndefined();
    expect(cache.get("r1")).toBe("c");
  });

  it("invalidateByPrefix removes matching keys", () => {
    cache.set("issues:owner=me&repo=a", "issues", "x");
    cache.set("issues:owner=me&repo=b", "issues", "y");
    cache.set("pullRequests:owner=me", "pullRequests", "z");

    const removed = cache.invalidateByPrefix("issues:");
    expect(removed).toBe(2);
    expect(cache.get("pullRequests:owner=me")).toBe("z");
  });

  it("clear flushes everything", () => {
    cache.set("a", "issues", 1);
    cache.set("b", "repoMetadata", 2);
    cache.clear();
    expect(cache.stats.entries).toBe(0);
  });

  // ── LRU eviction ─────────────────────────────────

  it("evicts oldest entries when maxEntries is exceeded", () => {
    const small = new CacheManager({
      maxEntries: 3,
      ttl: { issues: 60, pullRequests: 60, repoMetadata: 60, viewerRepos: 60, batchIssues: 60 },
    });

    small.set("k1", "issues", 1);
    small.set("k2", "issues", 2);
    small.set("k3", "issues", 3);
    small.set("k4", "issues", 4); // k1 should be evicted

    expect(small.get("k1")).toBeUndefined(); // evicted
    expect(small.get("k4")).toBe(4);
    expect(small.stats.evictions).toBe(1);
  });

  it("touch on get prevents eviction of recently accessed items", () => {
    const small = new CacheManager({
      maxEntries: 3,
      ttl: { issues: 60, pullRequests: 60, repoMetadata: 60, viewerRepos: 60, batchIssues: 60 },
    });

    small.set("k1", "issues", 1);
    small.set("k2", "issues", 2);
    small.set("k3", "issues", 3);
    small.get("k1"); // touch k1 → k2 is now oldest
    small.set("k4", "issues", 4); // k2 evicted, not k1

    expect(small.get("k1")).toBe(1);
    expect(small.get("k2")).toBeUndefined(); // evicted
  });

  // ── Stats ─────────────────────────────────────────

  it("computes hitRate correctly", () => {
    cache.set("k1", "issues", "x");
    cache.get("k1"); // hit
    cache.get("k1"); // hit
    cache.get("nope"); // miss

    expect(cache.stats.hitRate).toBeCloseTo(2 / 3);
  });

  it("hitRate is 0 with no lookups", () => {
    expect(cache.stats.hitRate).toBe(0);
  });

  it("resetStats clears counters", () => {
    cache.set("k1", "issues", "x");
    cache.get("k1");
    cache.get("miss");
    cache.resetStats();

    expect(cache.stats.hits).toBe(0);
    expect(cache.stats.misses).toBe(0);
  });

  // ── Disk persistence ──────────────────────────────

  it("round-trips through disk save/load", async () => {
    const tmpDir = `/tmp/launchpad-cache-test-${Date.now()}`;
    const diskCache = new CacheManager({
      diskPersistence: true,
      diskPath: tmpDir,
      ttl: { issues: 60, pullRequests: 60, repoMetadata: 300, viewerRepos: 300, batchIssues: 60 },
    });

    diskCache.set("k1", "issues", { n: 1 });
    diskCache.set("k2", "repoMetadata", { n: 2 });
    await diskCache.saveToDisk();

    // New cache instance loads from disk
    const fresh = new CacheManager({
      diskPersistence: true,
      diskPath: tmpDir,
      ttl: { issues: 60, pullRequests: 60, repoMetadata: 300, viewerRepos: 300, batchIssues: 60 },
    });
    const loaded = await fresh.loadFromDisk();
    expect(loaded).toBe(2);
    expect(fresh.get("k1")).toEqual({ n: 1 });
    expect(fresh.get("k2")).toEqual({ n: 2 });
  });

  it("does not load expired entries from disk", async () => {
    const tmpDir = `/tmp/launchpad-cache-test-expired-${Date.now()}`;
    const diskCache = new CacheManager({
      diskPersistence: true,
      diskPath: tmpDir,
      ttl: { issues: 1, pullRequests: 1, repoMetadata: 1, viewerRepos: 1, batchIssues: 1 },
    });

    diskCache.set("k1", "issues", "val");
    await diskCache.saveToDisk();

    vi.advanceTimersByTime(2_000); // past TTL

    const fresh = new CacheManager({
      diskPersistence: true,
      diskPath: tmpDir,
      ttl: { issues: 1, pullRequests: 1, repoMetadata: 1, viewerRepos: 1, batchIssues: 1 },
    });
    const loaded = await fresh.loadFromDisk();
    expect(loaded).toBe(0);
  });

  it("loadFromDisk returns 0 when disabled", async () => {
    const loaded = await cache.loadFromDisk();
    expect(loaded).toBe(0);
  });

  it("loadFromDisk returns 0 when file missing", async () => {
    const diskCache = new CacheManager({
      diskPersistence: true,
      diskPath: "/tmp/nonexistent-launchpad-cache",
    });
    const loaded = await diskCache.loadFromDisk();
    expect(loaded).toBe(0);
  });
});
