export { CacheManager, buildCacheKey } from "./cache-manager.js";
export type {
  CacheConfig,
  CacheDataType,
  CacheEntry,
  CacheStats,
  TtlConfig,
} from "./types.js";
export { DEFAULT_TTL, DEFAULT_MAX_ENTRIES } from "./types.js";
export { default as apiCachePlugin } from "./plugin.js";
