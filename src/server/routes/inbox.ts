/**
 * @deprecated This inbox module is superseded by the Activity Feed (Phase 4 — #72).
 * Scheduled for removal in a future release. Use /api/workflow/activity endpoints instead.
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { InboxMessage } from "../state/types.js";

// ---- Request / Response types -----------------------------------------------

interface ProjectParams {
  owner: string;
  repo: string;
}

interface MessageParams extends ProjectParams {
  id: string;
}

interface InboxQuery {
  status?: "unread" | "read" | "archived";
  sessionId?: string;
}

interface PatchBody {
  status: "read" | "archived";
}

const VALID_STATUSES = new Set(["unread", "read", "archived"]);
const VALID_PATCH_STATUSES = new Set(["read", "archived"]);

// ---- Route plugin -----------------------------------------------------------

const inboxRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/projects/:owner/:repo/inbox — list inbox messages
  fastify.get<{ Params: ProjectParams; Querystring: InboxQuery }>(
    "/api/projects/:owner/:repo/inbox",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { owner, repo } = request.params as ProjectParams;
      const query = request.query as InboxQuery;

      const inbox = await fastify.stateService.getInbox(owner, repo);
      let messages = inbox.messages;

      // Filter by status
      if (query.status && VALID_STATUSES.has(query.status)) {
        messages = messages.filter((m) => m.status === query.status);
      }

      // Filter by sessionId
      if (query.sessionId) {
        messages = messages.filter((m) => m.sessionId === query.sessionId);
      }

      // Sort newest first
      messages.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      const unread = inbox.messages.filter((m) => m.status === "unread").length;

      return {
        messages,
        total: messages.length,
        unread,
      };
    },
  );

  // GET /api/projects/:owner/:repo/inbox/count — unread count for badge
  fastify.get<{ Params: ProjectParams }>(
    "/api/projects/:owner/:repo/inbox/count",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { owner, repo } = request.params as ProjectParams;
      const inbox = await fastify.stateService.getInbox(owner, repo);
      const unread = inbox.messages.filter((m) => m.status === "unread").length;
      return { unread };
    },
  );

  // PATCH /api/projects/:owner/:repo/inbox/:id — update message status
  fastify.patch<{ Params: MessageParams }>(
    "/api/projects/:owner/:repo/inbox/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { owner, repo, id } = request.params as MessageParams;
      const body = request.body as PatchBody | undefined;

      if (!body || !VALID_PATCH_STATUSES.has(body.status)) {
        return reply.status(400).send({
          error: "validation_error",
          message: "Body must include 'status' set to 'read' or 'archived'.",
        });
      }

      const inbox = await fastify.stateService.getInbox(owner, repo);
      const message = inbox.messages.find((m) => m.id === id);

      if (!message) {
        return reply.status(404).send({
          error: "not_found",
          message: `Inbox message ${id} not found.`,
        });
      }

      const now = new Date().toISOString();
      message.status = body.status;
      if (body.status === "read" && !message.readAt) {
        message.readAt = now;
      }
      if (body.status === "archived") {
        message.archivedAt = now;
      }

      await fastify.stateService.saveInbox(owner, repo, inbox);

      // Broadcast update so UI can refresh badge count
      fastify.ws.broadcast("inbox", {
        type: "inbox:message-updated",
        projectId: `${owner}/${repo}`,
        message,
      });

      return message;
    },
  );
};

export default inboxRoutes;
