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
import { ElicitationStore } from "../workflow/elicitation-store.js";
import {
  coordinatorStarting,
  coordinatorStarted,
  coordinatorCrashed,
  coordinatorStopped,
  coordinatorHealthPing,
  addDispatch,
  updateDispatchStatus,
} from "../workflow/coordinator-state.js";
import { ActivityStore, type ActivityEventType, type ActivityQuery } from "../workflow/activity-store.js";
import { computeProjectStatus, type ProjectStatusBadge } from "../workflow/status-badge.js";
import type { CoordinatorProjectState, TrackedCommit } from "../../shared/protocol.js";

/** Build project key from route params */
function pk(params: { owner: string; repo: string }): string {
  return `${params.owner}/${params.repo}`;
}

declare module "fastify" {
  interface FastifyInstance {
    workflowStore: WorkflowStore;
    workflowStateMachine: WorkflowStateMachine;
    elicitationStore: ElicitationStore;
    activityStore: ActivityStore;
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

  // Elicitation store (in-memory only — not persisted)
  const elicitationStore = new ElicitationStore();

  // Activity feed store (in-memory ring buffer)
  const activityStore = new ActivityStore();

  // Decorate server
  server.decorate("workflowStore", store);
  server.decorate("workflowStateMachine", stateMachine);
  server.decorate("elicitationStore", elicitationStore);
  server.decorate("activityStore", activityStore);

  // Broadcast workflow events to WebSocket clients
  stateMachine.on((event: WorkflowEvent) => {
    server.ws.broadcast("workflow", event);
  });

  // Broadcast activity events to WebSocket clients in real time
  activityStore.onEvent((event) => {
    server.ws.broadcast("workflow", {
      type: "workflow:activity",
      event,
    });
  });

  // Elicitation timeout handler: notify clients and transition issue back
  elicitationStore.onTimeout((elicitation) => {
    const [owner, repo] = elicitation.projectId.split("/");

    server.ws.broadcast("workflow", {
      type: "workflow:elicitation-timeout",
      projectId: elicitation.projectId,
      elicitationId: elicitation.id,
      sessionId: elicitation.sessionId,
      issueNumber: elicitation.issueNumber,
    });

    // Emit activity event
    if (owner && repo) {
      activityStore.emit({
        type: "elicitation-timeout",
        projectOwner: owner,
        projectRepo: repo,
        issueNumber: elicitation.issueNumber,
        message: `Elicitation timed out${elicitation.issueNumber ? ` for issue #${elicitation.issueNumber}` : ""}`,
        severity: "warning",
      });
    }

    // Transition issue back to in-progress if it was in needs-input-blocking
    if (elicitation.issueNumber) {
      if (owner && repo) {
        const issue = store.getIssue(owner, repo, elicitation.issueNumber);
        if (issue && issue.state === "needs-input-blocking") {
          try {
            const updated = stateMachine.transition(issue, "in-progress", "Elicitation timed out");
            store.updateIssue(owner, repo, updated);
          } catch {
            // Transition may be invalid — ignore
          }
        }
      }
    }
  });

  // Flush on shutdown
  server.addHook("onClose", async () => {
    elicitationStore.close();
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
      const { owner, repo } = request.params;
      const issues = store.getIssues(owner, repo).map((issue) => ({
        ...issue,
        project: `${issue.owner}/${issue.repo}`,
      }));
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

  // ==========================================================================
  // Coordinator Endpoints (Phase 2 — #72)
  // ==========================================================================

  /** POST /api/workflow/:owner/:repo/coordinator/start — start/resume coordinator */
  server.post<{ Params: { owner: string; repo: string } }>(
    "/api/workflow/:owner/:repo/coordinator/start",
    async (request, reply) => {
      const { owner, repo } = request.params;
      const projectId = pk(request.params);

      // Check daemon is connected
      if (!server.daemonRegistry?.getDaemon(projectId)) {
        return reply.status(503).send({
          error: "daemon_offline",
          message: `Daemon for ${projectId} is not connected`,
        });
      }

      const coord = store.getCoordinator(owner, repo);

      // If already active, just return current status
      if (coord.status === "active" || coord.status === "starting") {
        return reply.send({ ok: true, coordinator: coord });
      }

      // Transition to starting
      const updated = coordinatorStarting(coord);
      store.setCoordinator(owner, repo, updated);

      // Send start message to daemon (include sessionId for resume if available)
      const sent = server.daemonRegistry.sendToDaemon(projectId, {
        type: "workflow:start-coordinator",
        timestamp: Date.now(),
        payload: {
          projectId,
          ...(coord.sessionId ? { sessionId: coord.sessionId } : {}),
        },
      });

      if (!sent) {
        const reverted = coordinatorStopped(updated);
        store.setCoordinator(owner, repo, reverted);
        return reply.status(503).send({
          error: "send_failed",
          message: "Failed to send start message to daemon",
        });
      }

      server.ws.broadcast("workflow", {
        type: "workflow:coordinator-status-changed",
        projectId,
        status: "starting",
      });

      return reply.send({ ok: true, coordinator: updated });
    },
  );

  /** POST /api/workflow/:owner/:repo/coordinator/stop — stop coordinator */
  server.post<{ Params: { owner: string; repo: string } }>(
    "/api/workflow/:owner/:repo/coordinator/stop",
    async (request, reply) => {
      const { owner, repo } = request.params;
      const projectId = pk(request.params);

      const coord = store.getCoordinator(owner, repo);

      if (coord.status === "idle") {
        return reply.send({ ok: true, coordinator: coord });
      }

      // Send stop to daemon
      server.daemonRegistry?.sendToDaemon(projectId, {
        type: "workflow:stop-coordinator",
        timestamp: Date.now(),
        payload: { projectId },
      });

      const updated = coordinatorStopped(coord);
      store.setCoordinator(owner, repo, updated);

      server.ws.broadcast("workflow", {
        type: "workflow:coordinator-status-changed",
        projectId,
        status: "idle",
      });

      return reply.send({ ok: true, coordinator: updated });
    },
  );

  /** GET /api/workflow/:owner/:repo/coordinator/status — get coordinator health */
  server.get<{ Params: { owner: string; repo: string } }>(
    "/api/workflow/:owner/:repo/coordinator/status",
    async (request, reply) => {
      const coord = store.getCoordinator(request.params.owner, request.params.repo);
      return reply.send({ coordinator: coord });
    },
  );

  /** POST /api/workflow/:owner/:repo/dispatch/:issueNumber — dispatch issue to coordinator */
  server.post<{ Params: { owner: string; repo: string; issueNumber: string } }>(
    "/api/workflow/:owner/:repo/dispatch/:issueNumber",
    async (request, reply) => {
      const { owner, repo } = request.params;
      const issueNumber = parseInt(request.params.issueNumber, 10);
      const projectId = pk(request.params);

      if (isNaN(issueNumber)) {
        return reply.status(400).send({ error: "bad_request", message: "Invalid issue number" });
      }

      // Validate issue exists and is in backlog
      const issue = store.getIssue(owner, repo, issueNumber);
      if (!issue) {
        return reply.status(404).send({
          error: "not_found",
          message: `Issue #${issueNumber} not found. Run sync first.`,
        });
      }

      if (issue.state !== "backlog") {
        return reply.status(422).send({
          error: "invalid_state",
          message: `Issue #${issueNumber} is in '${issue.state}', must be 'backlog' to dispatch`,
        });
      }

      // Check coordinator is active
      const coord = store.getCoordinator(owner, repo);
      if (coord.status !== "active") {
        return reply.status(422).send({
          error: "coordinator_not_active",
          message: `Coordinator is '${coord.status}', must be 'active' to dispatch`,
        });
      }

      // Transition issue to in-progress
      try {
        const updated = stateMachine.transition(issue, "in-progress", "Dispatched to coordinator");
        store.updateIssue(owner, repo, updated);
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          return reply.status(422).send({
            error: "invalid_transition",
            message: err.message,
          });
        }
        throw err;
      }

      // Add dispatch record
      const updatedCoord = addDispatch(coord, issueNumber);
      store.setCoordinator(owner, repo, updatedCoord);

      // Send dispatch to daemon
      const sent = server.daemonRegistry?.sendToDaemon(projectId, {
        type: "workflow:dispatch-issue",
        timestamp: Date.now(),
        payload: {
          projectId,
          issueNumber: issue.number,
          title: issue.title,
          labels: issue.labels,
        },
      });

      if (!sent) {
        return reply.status(503).send({
          error: "send_failed",
          message: "Failed to send dispatch to daemon",
        });
      }

      // Broadcast dispatch started to clients
      server.ws.broadcast("workflow", {
        type: "workflow:dispatch-started",
        projectId,
        issueNumber,
        title: issue.title,
      });

      // Emit activity event
      activityStore.emit({
        type: "issue-dispatched",
        projectOwner: owner,
        projectRepo: repo,
        issueNumber,
        message: `Issue #${issueNumber} "${issue.title}" dispatched to coordinator`,
        severity: "info",
      });

      return reply.send({ ok: true, issueNumber, status: "dispatched" });
    },
  );

  /** GET /api/workflow/:owner/:repo/issues/:number/commits — get commits for an issue */
  server.get<{ Params: { owner: string; repo: string; number: string } }>(
    "/api/workflow/:owner/:repo/issues/:number/commits",
    async (request, reply) => {
      const { owner, repo } = request.params;
      const issueNumber = parseInt(request.params.number, 10);

      if (isNaN(issueNumber)) {
        return reply.status(400).send({ error: "bad_request", message: "Invalid issue number" });
      }

      const commits = store.commitTracker.getCommitsForIssue(owner, repo, issueNumber);
      return reply.send({ commits });
    },
  );

  // ==========================================================================
  // Elicitation Relay Endpoints (Phase 3 — #72)
  // ==========================================================================

  /** GET /api/workflow/:owner/:repo/elicitations — list pending elicitations */
  server.get<{ Params: { owner: string; repo: string } }>(
    "/api/workflow/:owner/:repo/elicitations",
    async (request, reply) => {
      const projectId = pk(request.params);
      const pending = elicitationStore.getByProject(projectId);
      return reply.send({ elicitations: pending });
    },
  );

  /** POST /api/workflow/:owner/:repo/elicitation/:id/respond — user answers an elicitation */
  server.post<{
    Params: { owner: string; repo: string; id: string };
    Body: { response: Record<string, unknown> };
  }>(
    "/api/workflow/:owner/:repo/elicitation/:id/respond",
    async (request, reply) => {
      const { owner, repo, id } = request.params;
      const projectId = pk(request.params);
      const { response } = request.body ?? {};

      if (!response || typeof response !== "object") {
        return reply.status(400).send({ error: "bad_request", message: "Missing 'response' object" });
      }

      const elicitation = elicitationStore.get(id);
      if (!elicitation) {
        return reply.status(404).send({
          error: "not_found",
          message: `Elicitation '${id}' not found`,
        });
      }

      if (elicitation.projectId !== projectId) {
        return reply.status(404).send({
          error: "not_found",
          message: `Elicitation '${id}' not found for project ${projectId}`,
        });
      }

      if (elicitation.status !== "pending") {
        return reply.status(422).send({
          error: "already_resolved",
          message: `Elicitation '${id}' is already ${elicitation.status}`,
        });
      }

      // Mark as answered
      const updated = elicitationStore.answer(id, response);

      // Send response to daemon
      server.daemonRegistry?.sendToDaemon(projectId, {
        type: "workflow:elicitation-response",
        timestamp: Date.now(),
        payload: {
          projectId,
          sessionId: elicitation.sessionId,
          elicitationId: id,
          response,
        },
      });

      // Transition issue back to in-progress if it was blocking
      if (elicitation.issueNumber) {
        const issue = store.getIssue(owner, repo, elicitation.issueNumber);
        if (issue && issue.state === "needs-input-blocking") {
          try {
            const transitioned = stateMachine.transition(issue, "in-progress", "Elicitation answered");
            store.updateIssue(owner, repo, transitioned);
          } catch {
            // Transition may be invalid — ignore
          }
        }
      }

      // Broadcast answered event to clients
      server.ws.broadcast("workflow", {
        type: "workflow:elicitation-answered",
        projectId,
        elicitationId: id,
        sessionId: elicitation.sessionId,
        issueNumber: elicitation.issueNumber,
      });

      // Emit activity event
      activityStore.emit({
        type: "elicitation-answered",
        projectOwner: owner,
        projectRepo: repo,
        issueNumber: elicitation.issueNumber,
        message: `Elicitation answered${elicitation.issueNumber ? ` for issue #${elicitation.issueNumber}` : ""}`,
        severity: "info",
      });

      return reply.send({ ok: true, elicitation: updated });
    },
  );

  // ==========================================================================
  // Activity Feed Endpoints (Phase 4 — #72)
  // ==========================================================================

  /** Parse common activity query params */
  function parseActivityQuery(query: Record<string, unknown>): ActivityQuery {
    const result: ActivityQuery = {};
    if (typeof query.since === "string" && query.since) {
      result.since = query.since;
    }
    if (typeof query.limit === "string" && query.limit) {
      const n = parseInt(query.limit, 10);
      if (!isNaN(n) && n > 0) result.limit = n;
    }
    if (typeof query.types === "string" && query.types) {
      result.types = query.types.split(",").filter(Boolean) as ActivityEventType[];
    }
    return result;
  }

  /** GET /api/workflow/activity — global activity feed (all projects) */
  server.get<{
    Querystring: { since?: string; limit?: string; types?: string };
  }>(
    "/api/workflow/activity",
    async (request, reply) => {
      const query = parseActivityQuery(request.query);
      const result = activityStore.getGlobal(query);
      return reply.send(result);
    },
  );

  /** GET /api/workflow/:owner/:repo/activity — project-specific activity feed */
  server.get<{
    Params: { owner: string; repo: string };
    Querystring: { since?: string; limit?: string; types?: string };
  }>(
    "/api/workflow/:owner/:repo/activity",
    async (request, reply) => {
      const { owner, repo } = request.params;
      const query = parseActivityQuery(request.query);
      const result = activityStore.getByProject(owner, repo, query);
      return reply.send(result);
    },
  );

  // ==========================================================================
  // Status Badge Endpoints (Phase 4 — #72)
  // ==========================================================================

  /** GET /api/workflow/:owner/:repo/status — computed project status badge */
  server.get<{ Params: { owner: string; repo: string } }>(
    "/api/workflow/:owner/:repo/status",
    async (request, reply) => {
      const { owner, repo } = request.params;
      const coordinator = store.getCoordinator(owner, repo);
      const issues = store.getIssues(owner, repo);
      const badge = computeProjectStatus(owner, repo, coordinator, issues, elicitationStore);
      return reply.send(badge);
    },
  );

  /** GET /api/workflow/status — all projects' status badges */
  server.get(
    "/api/workflow/status",
    async (_request, reply) => {
      const data = store.getData();
      const badges: ProjectStatusBadge[] = [];
      for (const [, project] of Object.entries(data.projects)) {
        const badge = computeProjectStatus(
          project.owner,
          project.repo,
          project.coordinator,
          project.issues,
          elicitationStore,
        );
        badges.push(badge);
      }
      return reply.send({ projects: badges });
    },
  );

  // ==========================================================================
  // Daemon event listeners for coordinator messages
  // ==========================================================================

  if (server.daemonRegistry) {
    server.daemonRegistry.on("workflow:coordinator-started" as never, (payload: { projectId: string; sessionId: string }) => {
      const [owner, repo] = payload.projectId.split("/");
      if (!owner || !repo) return;
      const coord = store.getCoordinator(owner, repo);
      const updated = coordinatorStarted(coord, payload.sessionId);
      store.setCoordinator(owner, repo, updated);

      activityStore.emit({
        type: "coordinator-started",
        projectOwner: owner,
        projectRepo: repo,
        message: `Coordinator started (session ${payload.sessionId.slice(0, 8)}…)`,
        severity: "info",
      });
    });

    server.daemonRegistry.on("workflow:coordinator-crashed" as never, (payload: { projectId: string; error: string }) => {
      const [owner, repo] = payload.projectId.split("/");
      if (!owner || !repo) return;
      const coord = store.getCoordinator(owner, repo);
      const updated = coordinatorCrashed(coord, payload.error);
      store.setCoordinator(owner, repo, updated);

      activityStore.emit({
        type: "coordinator-crashed",
        projectOwner: owner,
        projectRepo: repo,
        message: `Coordinator crashed: ${payload.error}`,
        severity: "urgent",
      });
    });

    server.daemonRegistry.on("workflow:coordinator-health" as never, (payload: { projectId: string; sessionId: string }) => {
      const [owner, repo] = payload.projectId.split("/");
      if (!owner || !repo) return;
      const coord = store.getCoordinator(owner, repo);
      const updated = coordinatorHealthPing(coord);
      store.setCoordinator(owner, repo, updated);
    });

    server.daemonRegistry.on("workflow:progress" as never, (payload: {
      projectId: string;
      issueNumber: number;
      commits?: Array<{ sha: string; message: string; author?: string }>;
    }) => {
      const [owner, repo] = payload.projectId.split("/");
      if (!owner || !repo) return;

      // Track commits reported in progress events
      if (payload.commits) {
        for (const c of payload.commits) {
          store.commitTracker.addCommit(owner, repo, c.sha, c.message, c.author ?? null);
        }
      }

      // Update dispatch status to in-progress
      const coord = store.getCoordinator(owner, repo);
      const updated = updateDispatchStatus(coord, payload.issueNumber, "in-progress");
      store.setCoordinator(owner, repo, updated);

      activityStore.emit({
        type: "progress",
        projectOwner: owner,
        projectRepo: repo,
        issueNumber: payload.issueNumber,
        message: `Progress on issue #${payload.issueNumber}${payload.commits?.length ? ` (${payload.commits.length} commit(s))` : ""}`,
        severity: "info",
      });
    });

    server.daemonRegistry.on("workflow:issue-completed" as never, (payload: {
      projectId: string;
      issueNumber: number;
      summary?: string;
      commits?: Array<{ sha: string; message: string; author?: string }>;
    }) => {
      const [owner, repo] = payload.projectId.split("/");
      if (!owner || !repo) return;

      // Track final commits
      if (payload.commits) {
        for (const c of payload.commits) {
          store.commitTracker.addCommit(owner, repo, c.sha, c.message, c.author ?? null);
        }
      }

      // Transition issue to ready-for-review
      const issue = store.getIssue(owner, repo, payload.issueNumber);
      if (issue && issue.state === "in-progress") {
        try {
          const updated = stateMachine.transition(issue, "ready-for-review", payload.summary ?? "Completed by coordinator");
          store.updateIssue(owner, repo, updated);
        } catch {
          // Transition may be invalid if issue was already moved — ignore
        }
      }

      // Update dispatch record
      const coord = store.getCoordinator(owner, repo);
      const updatedCoord = updateDispatchStatus(coord, payload.issueNumber, "completed");
      store.setCoordinator(owner, repo, updatedCoord);

      activityStore.emit({
        type: "issue-completed",
        projectOwner: owner,
        projectRepo: repo,
        issueNumber: payload.issueNumber,
        message: `Issue #${payload.issueNumber} completed${payload.summary ? `: ${payload.summary}` : ""}`,
        severity: "info",
      });
    });

    // --- Elicitation relay ---

    server.daemonRegistry.on("workflow:elicitation-requested" as never, (payload: {
      projectId: string;
      sessionId: string;
      elicitationId: string;
      issueNumber?: number;
      message: string;
      requestedSchema?: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
    }) => {
      const [owner, repo] = payload.projectId.split("/");
      if (!owner || !repo) return;

      // Store the pending elicitation
      elicitationStore.add({
        id: payload.elicitationId,
        sessionId: payload.sessionId,
        projectId: payload.projectId,
        message: payload.message,
        requestedSchema: payload.requestedSchema ?? { type: 'object', properties: {} },
        issueNumber: payload.issueNumber,
      });

      // Transition associated issue to needs-input-blocking
      if (payload.issueNumber) {
        const issue = store.getIssue(owner, repo, payload.issueNumber);
        if (issue && issue.state === "in-progress") {
          try {
            const updated = stateMachine.transition(issue, "needs-input-blocking", "Elicitation requested");
            store.updateIssue(owner, repo, updated);
          } catch {
            // Transition may be invalid — ignore
          }
        }
      }

      activityStore.emit({
        type: "elicitation-requested",
        projectOwner: owner,
        projectRepo: repo,
        issueNumber: payload.issueNumber,
        message: `Elicitation requested${payload.issueNumber ? ` for issue #${payload.issueNumber}` : ""}: ${payload.message.slice(0, 100)}`,
        severity: "warning",
      });
    });
  }
};

export default workflowRoutes;
