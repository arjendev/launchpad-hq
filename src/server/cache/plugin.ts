// ────────────────────────────────────────────────────────
// Fastify plugin — registers CacheManager + stats route
// ────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { CacheManager } from "./cache-manager.js";
import type { CacheConfig, CacheDataType } from "./types.js";

declare module "fastify" {
  interface FastifyInstance {
    cache: CacheManager;
  }
}

export interface ApiCachePluginOpts {
  cache?: Partial<CacheConfig>;
}

async function apiCachePlugin(
  fastify: FastifyInstance,
  opts: ApiCachePluginOpts,
) {
  const cache = new CacheManager(opts.cache);

  // Restore from disk on startup
  const loaded = await cache.loadFromDisk();
  if (loaded > 0) {
    fastify.log.info(`API cache: restored ${loaded} entries from disk`);
  }

  fastify.decorate("cache", cache);

  // Persist to disk on shutdown
  fastify.addHook("onClose", async () => {
    await cache.saveToDisk();
  });

  // ── Stats endpoint ────────────────────────────────

  fastify.get("/api/cache/stats", async () => {
    return cache.stats;
  });

  // ── Invalidation endpoints ────────────────────────

  fastify.delete<{ Params: { key: string } }>(
    "/api/cache/entries/:key",
    async (request, reply) => {
      const found = cache.invalidate(decodeURIComponent(request.params.key));
      if (!found) {
        return reply.code(404).send({ error: "Key not found" });
      }
      return { ok: true };
    },
  );

  fastify.delete<{ Params: { dataType: string } }>(
    "/api/cache/types/:dataType",
    async (request, reply) => {
      const dataType = request.params.dataType as CacheDataType;
      const count = cache.invalidateByType(dataType);
      if (count === 0) {
        return reply.code(404).send({ error: "No entries for that type" });
      }
      return { ok: true, invalidated: count };
    },
  );

  fastify.delete("/api/cache", async () => {
    cache.clear();
    return { ok: true };
  });
}

export default fp(apiCachePlugin, {
  name: "api-cache",
});
