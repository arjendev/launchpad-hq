// ────────────────────────────────────────────────────────
// GitHub API cache — type definitions
// ────────────────────────────────────────────────────────

/** Categories of cacheable GitHub API data, each with its own default TTL. */
export type CacheDataType =
  | "issues"
  | "pullRequests"
  | "repoMetadata"
  | "viewerRepos"
  | "batchIssues";

/** A single cached value with metadata for TTL tracking. */
export interface CacheEntry<T = unknown> {
  /** The cached data. */
  data: T;
  /** When this entry was stored (epoch ms). */
  storedAt: number;
  /** When this entry expires (epoch ms). */
  expiresAt: number;
  /** Cache key that produced this entry. */
  key: string;
  /** Data type category. */
  dataType: CacheDataType;
}

/** Per-data-type TTL configuration (seconds). */
export type TtlConfig = Record<CacheDataType, number>;

/** Full cache configuration. */
export interface CacheConfig {
  /** TTL per data type (seconds). */
  ttl: TtlConfig;
  /** Maximum number of entries before LRU eviction kicks in. */
  maxEntries: number;
  /** Enable disk persistence for cold-start recovery. */
  diskPersistence: boolean;
  /** Directory for disk snapshots (default: ~/.launchpad/api-cache). */
  diskPath?: string;
}

/** Hit/miss/eviction stats. */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  entries: number;
  /** Hit rate as a 0–1 ratio (NaN when no lookups yet). */
  hitRate: number;
}

/** Serialised snapshot written to disk. */
export interface DiskSnapshot {
  version: 1;
  savedAt: string; // ISO 8601
  entries: Array<CacheEntry>;
}

/** Default TTLs (seconds). */
export const DEFAULT_TTL: TtlConfig = {
  issues: 60,
  pullRequests: 60,
  repoMetadata: 300,
  viewerRepos: 300,
  batchIssues: 60,
};

export const DEFAULT_MAX_ENTRIES = 500;
