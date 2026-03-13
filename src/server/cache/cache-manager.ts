// ────────────────────────────────────────────────────────
// CacheManager — TTL-based in-memory cache for GitHub API
// ────────────────────────────────────────────────────────

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

import type {
  CacheConfig,
  CacheDataType,
  CacheEntry,
  CacheStats,
  DiskSnapshot,
  TtlConfig,
} from "./types.js";
import { DEFAULT_TTL, DEFAULT_MAX_ENTRIES } from "./types.js";

// ── Cache key builder ───────────────────────────────────

/** Build a deterministic cache key from data type + parameters. */
export function buildCacheKey(
  dataType: CacheDataType,
  params: Record<string, unknown> = {},
): string {
  const sortedParts = Object.keys(params)
    .sort()
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}=${String(params[k])}`);

  return sortedParts.length > 0
    ? `${dataType}:${sortedParts.join("&")}`
    : dataType;
}

// ── CacheManager ────────────────────────────────────────

export class CacheManager {
  private store = new Map<string, CacheEntry>();
  private accessOrder: string[] = []; // most-recently-used at end

  private ttl: TtlConfig;
  private maxEntries: number;
  private diskEnabled: boolean;
  private diskPath: string;

  // stats
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(config: Partial<CacheConfig> = {}) {
    this.ttl = { ...DEFAULT_TTL, ...config.ttl };
    this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.diskEnabled = config.diskPersistence ?? false;
    this.diskPath =
      config.diskPath ?? join(homedir(), ".launchpad", "api-cache");
  }

  // ── Core API ────────────────────────────────────────

  /** Get a cached value. Returns undefined on miss or expiry. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.removeFromAccessOrder(key);
      this._misses++;
      return undefined;
    }
    this._hits++;
    this.touchAccessOrder(key);
    return entry.data as T;
  }

  /** Store a value with TTL based on its data type. */
  set<T>(key: string, dataType: CacheDataType, data: T): void {
    const ttlMs = this.ttl[dataType] * 1000;
    const now = Date.now();

    const entry: CacheEntry<T> = {
      data,
      storedAt: now,
      expiresAt: now + ttlMs,
      key,
      dataType,
    };

    this.store.set(key, entry as CacheEntry);
    this.touchAccessOrder(key);
    this.evictIfNeeded();
  }

  /** Cache-through helper: check cache, on miss call fetcher, store result. */
  async getOrFetch<T>(
    key: string,
    dataType: CacheDataType,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const data = await fetcher();
    this.set(key, dataType, data);
    return data;
  }

  // ── Invalidation ────────────────────────────────────

  /** Remove a specific key. */
  invalidate(key: string): boolean {
    const existed = this.store.delete(key);
    if (existed) this.removeFromAccessOrder(key);
    return existed;
  }

  /** Remove all entries matching a data type. */
  invalidateByType(dataType: CacheDataType): number {
    let count = 0;
    for (const [key, entry] of this.store) {
      if (entry.dataType === dataType) {
        this.store.delete(key);
        this.removeFromAccessOrder(key);
        count++;
      }
    }
    return count;
  }

  /** Remove all entries whose key starts with a given prefix. */
  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        this.removeFromAccessOrder(key);
        count++;
      }
    }
    return count;
  }

  /** Flush the entire cache. */
  clear(): void {
    this.store.clear();
    this.accessOrder = [];
  }

  // ── Stats ───────────────────────────────────────────

  get stats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      entries: this.store.size,
      hitRate: total > 0 ? this._hits / total : 0,
    };
  }

  resetStats(): void {
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  // ── Disk persistence ────────────────────────────────

  /** Write current cache to disk for cold-start recovery. */
  async saveToDisk(): Promise<void> {
    if (!this.diskEnabled) return;

    // Prune expired before saving
    this.pruneExpired();

    const snapshot: DiskSnapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      entries: [...this.store.values()],
    };

    const filePath = join(this.diskPath, "cache-snapshot.json");
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(snapshot), "utf-8");
  }

  /** Load cache from disk. Only restores entries that haven't expired. */
  async loadFromDisk(): Promise<number> {
    if (!this.diskEnabled) return 0;

    const filePath = join(this.diskPath, "cache-snapshot.json");
    if (!existsSync(filePath)) return 0;

    try {
      const raw = await readFile(filePath, "utf-8");
      const snapshot = JSON.parse(raw) as DiskSnapshot;
      if (snapshot.version !== 1) return 0;

      const now = Date.now();
      let loaded = 0;
      for (const entry of snapshot.entries) {
        if (entry.expiresAt > now) {
          this.store.set(entry.key, entry);
          this.touchAccessOrder(entry.key);
          loaded++;
        }
      }
      return loaded;
    } catch {
      return 0;
    }
  }

  // ── Internal ────────────────────────────────────────

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        this.removeFromAccessOrder(key);
      }
    }
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift()!;
      this.store.delete(oldest);
      this._evictions++;
    }
  }

  private touchAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
  }
}
