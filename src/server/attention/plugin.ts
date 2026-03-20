/**
 * @deprecated The attention plugin is superseded by the Activity Feed and Status Badges (Phase 4 — #72).
 * Scheduled for removal in a future release.
 */

// ────────────────────────────────────────────────────────
// Fastify plugin — registers AttentionManager + REST routes
// ────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AttentionManager } from "./manager.js";
import type {
  AttentionConfig,
  AttentionQuery,
  AttentionSeverity,
  AttentionType,
  AttentionItem,
} from "./types.js";
import type { Channel } from "../ws/types.js";

declare module "fastify" {
  interface FastifyInstance {
    attention: AttentionManager;
  }
}

export interface AttentionPluginOpts {
  config?: Partial<AttentionConfig>;
}

async function attentionPlugin(
  fastify: FastifyInstance,
  opts: AttentionPluginOpts,
) {
  const manager = new AttentionManager(opts.config);

  // Wire up dependencies once the server is ready
  fastify.addHook("onReady", () => {
    manager.init({
      graphql: fastify.githubGraphQL,
      stateService: fastify.stateService,
      broadcast: (items: AttentionItem[]) => {
        fastify.ws.broadcast("attention" as Channel, {
          type: "attention:new",
          items,
          unreadCount: manager.unreadCount(),
        });
      },
    });
    manager.start();
    fastify.log.info("Attention system started");
  });

  fastify.decorate("attention", manager);

  // Clean up on shutdown
  fastify.addHook("onClose", () => {
    manager.stop();
  });

  // ── REST endpoints ──────────────────────────────────

  /** GET /api/attention — list attention items with optional filters. */
  fastify.get<{
    Querystring: {
      severity?: string;
      project?: string;
      type?: string;
      dismissed?: string;
    };
  }>("/api/attention", async (request) => {
    const query: AttentionQuery = {};

    if (request.query.severity) {
      query.severity = request.query.severity as AttentionSeverity;
    }
    if (request.query.project) {
      query.project = request.query.project;
    }
    if (request.query.type) {
      query.type = request.query.type as AttentionType;
    }
    if (request.query.dismissed !== undefined) {
      query.dismissed = request.query.dismissed === "true";
    }

    return { items: manager.list(query) };
  });

  /** GET /api/attention/count — unread count for badge display. */
  fastify.get("/api/attention/count", async () => {
    return {
      total: manager.unreadCount(),
      bySeverity: manager.unreadCountBySeverity(),
    };
  });

  /** POST /api/attention/:id/dismiss — mark an item as dismissed. */
  fastify.post<{ Params: { id: string } }>(
    "/api/attention/:id/dismiss",
    async (request, reply) => {
      const { id } = request.params;
      const found = manager.dismiss(id);
      if (!found) {
        return reply.code(404).send({
          error: "NOT_FOUND",
          message: `Attention item ${id} not found`,
        });
      }
      return {
        ok: true,
        unreadCount: manager.unreadCount(),
      };
    },
  );
}

export default fp(attentionPlugin, {
  name: "attention",
});
