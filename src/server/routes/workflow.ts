/**
 * Workflow REST API endpoints
 *
 * Registered as a Fastify plugin. All routes are under /api/workflow/.
 * Auth is applied globally by the auth plugin for /api/* routes.
 */

import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import {
  WorkflowStateMachine,
  InvalidTransitionError,
  isValidState,
  type WorkflowIssue,
  type WorkflowEvent,
  type FeedbackEntry,
} from "../workflow/state-machine.js";
import { GitHubSyncService } from "../workflow/github-sync.js";
import { WorkflowStore } from "../workflow/store.js";

/** Build project key from route params */
function pk(params: { owner: string; repo: string }): string {
  return `${params.owner}/${params.repo}`;
}

declare module "fastify" {
  interface FastifyInstance {
    workflowStore: WorkflowStore;
    workflowStateMachine: WorkflowStateMachine;
  }
}

const workflowRoutes: FastifyPluginAsync = async (server) => {
  // --- Initialize workflow subsystem ---

  const stateMachine = new WorkflowStateMachine();
  const store = new WorkflowStore(
    server.stateService ?? null,
    30_000,
  );

  // Load persisted state
  await store.load();

  // Decorate server
  server.decorate("workflowStore", store);
  server.decorate("workflowStateMachine", stateMachine);

  // Broadcast workflow events to WebSocket clients
  stateMachine.on((event: WorkflowEvent) => {
    server.ws.broadcast("workflow", event);
  });

  // Flush on shutdown
  server.addHook("onClose", async () => {
    await store.close();
  });

  // Helper: get gh token from the auth plugin decorator
  function getGhToken(): string {
    const token = server.githubToken;
    if (!token) throw new Error("GitHub token not available");
    return token;
  }

  // --- Routes ---

  /** GET /api/workflow/:owner/:repo/issues — list tracked issues with HQ state */
  server.get<{ Params: { owner: string; repo: string } }>(
    "/api/workflow/:owner/:repo/issues",
    async (request, reply) => {
      const issues = store.getIssues(request.params.owner, request.params.repo);
      return reply.send({ issues });
    },
  );

  /** POST /api/workflow/:owner/:repo/sync — trigger GitHub sync */
  server.post<{ Params: { owner: string; repo: string } }>(
    "/api/workflow/:owner/:repo/sync",
    async (request, reply) => {
      const { owner, repo } = request.params;
      try {
        const token = getGhToken();
        const syncService = new GitHubSyncService(token);

        // Build existing issue map
        const existing = new Map<number, WorkflowIssue>();
        for (const issue of store.getIssues(owner, repo)) {
          existing.set(issue.number, issue);
        }

        const result = await syncService.syncIssues(owner, repo, existing);
        store.setIssues(owner, repo, result.issues);

        // Broadcast sync completed
        stateMachine.emitSyncCompleted(owner, repo, result.issues.length);

        return reply.send({
          ok: true,
          issueCount: result.issues.length,
          added: result.added,
          updated: result.updated,
          errors: result.errors,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({
          error: "sync_failed",
          message: `GitHub sync failed: ${message}`,
        });
      }
    },
  );

  /** PUT /api/workflow/:owner/:repo/issues/:number/state — transition issue state */
  server.put<{
    Params: { owner: string; repo: string; number: string };
    Body: { state: string; reason?: string };
  }>(
    "/api/workflow/:owner/:repo/issues/:number/state",
    async (request, reply) => {
      const { owner, repo } = request.params;
      const issueNumber = parseInt(request.params.number, 10);
      const { state: targetState, reason } = request.body ?? {};

      if (isNaN(issueNumber)) {
        return reply.status(400).send({ error: "bad_request", message: "Invalid issue number" });
      }

      if (!targetState || !isValidState(targetState)) {
        return reply.status(400).send({
          error: "bad_request",
          message: `Invalid state: '${targetState}'. Valid states: backlog, in-progress, needs-input-blocking, needs-input-async, ready-for-review, done`,
        });
      }

      const issue = store.getIssue(owner, repo, issueNumber);
      if (!issue) {
        return reply.status(404).send({
          error: "not_found",
          message: `Issue #${issueNumber} not found. Run sync first.`,
        });
      }

      try {
        const updated = stateMachine.transition(issue, targetState, reason);
        store.updateIssue(owner, repo, updated);

        // Sync label and post comment to GitHub in background (best-effort)
        try {
          const token = getGhToken();
          const syncService = new GitHubSyncService(token);
          syncService.syncLabelToGitHub(owner, repo, issueNumber, targetState).catch((err) => {
            console.warn(`GitHub label sync failed for ${pk(request.params)}#${issueNumber}:`, err);
          });
          syncService.postTransitionComment(owner, repo, issueNumber, issue.state, targetState, reason).catch((err) => {
            console.warn(`GitHub comment failed for ${pk(request.params)}#${issueNumber}:`, err);
          });
        } catch {
          // Token not available — skip GitHub sync
        }

        return reply.send({ ok: true, issue: updated });
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          return reply.status(422).send({
            error: "invalid_transition",
            message: err.message,
            from: err.from,
            to: err.to,
          });
        }
        throw err;
      }
    },
  );

  /** POST /api/workflow/:owner/:repo/issues/:number/feedback — add async feedback */
  server.post<{
    Params: { owner: string; repo: string; number: string };
    Body: { message: string; author?: string };
  }>(
    "/api/workflow/:owner/:repo/issues/:number/feedback",
    async (request, reply) => {
      const { owner, repo } = request.params;
      const issueNumber = parseInt(request.params.number, 10);
      const { message, author } = request.body ?? {};

      if (isNaN(issueNumber)) {
        return reply.status(400).send({ error: "bad_request", message: "Invalid issue number" });
      }

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return reply.status(400).send({ error: "bad_request", message: "Missing 'message' field" });
      }

      const issue = store.getIssue(owner, repo, issueNumber);
      if (!issue) {
        return reply.status(404).send({
          error: "not_found",
          message: `Issue #${issueNumber} not found. Run sync first.`,
        });
      }

      const feedback: FeedbackEntry = {
        id: randomUUID(),
        author: author ?? "anonymous",
        message: message.trim(),
        createdAt: new Date().toISOString(),
      };

      const updated = store.addFeedback(owner, repo, issueNumber, feedback);

      // Post as GitHub comment in background (best-effort)
      try {
        const token = getGhToken();
        const syncService = new GitHubSyncService(token);
        syncService.postFeedbackComment(owner, repo, issueNumber, feedback).catch((err) => {
          console.warn(`GitHub feedback comment failed for ${pk(request.params)}#${issueNumber}:`, err);
        });
      } catch {
        // Token not available — skip GitHub sync
      }

      return reply.send({ ok: true, feedback, issue: updated });
    },
  );
};

export default workflowRoutes;
