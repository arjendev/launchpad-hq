/**
 * Daemon event listeners for the workflow subsystem.
 *
 * Handles all daemon→HQ workflow messages: coordinator lifecycle,
 * progress, completions, elicitations, and auto-start on connect.
 * Also owns all workflow-related browser broadcasts that were
 * previously split across handler.ts and routes/workflow.ts.
 *
 * Called from the workflow plugin — not registered as a standalone plugin.
 */

import type { FastifyInstance } from "fastify";
import {
  coordinatorStarting,
  coordinatorStarted,
  coordinatorCrashed,
  coordinatorStopped,
  coordinatorHealthPing,
  updateDispatchStatus,
  getActiveDispatches,
} from "./coordinator-state.js";
import type {
  WorkflowCoordinatorStartedPayload,
  WorkflowCoordinatorCrashedPayload,
  WorkflowCoordinatorHealthPayload,
  WorkflowProgressPayload,
  WorkflowIssueCompletedPayload,
  WorkflowElicitationRequestedPayload,
  WorkflowDispatchStartedPayload,
} from "../daemon-registry/event-bus.js";

/**
 * Wire up all daemon event listeners for workflow.
 * Requires server.workflowStore, server.workflowStateMachine,
 * server.elicitationStore, and server.activityStore to be decorated.
 */
export function registerWorkflowDaemonEvents(server: FastifyInstance): void {
  if (!server.daemonRegistry) return;

  const { workflowStore: store, workflowStateMachine: stateMachine, elicitationStore, activityStore } = server;

  // Auto-start coordinator when a daemon connects (HQ-driven, with resume)
  server.daemonRegistry.on("daemon:connected", (summary: { daemonId: string }) => {
    const [owner, repo] = summary.daemonId.split("/");
    if (!owner || !repo) return;

    const coord = store.getCoordinator(owner, repo);
    if (coord.status === "active" || coord.status === "starting") return;

    const updated = coordinatorStarting(coord);
    store.setCoordinator(owner, repo, updated);

    void (async () => {
      let agentId: string | null = null;
      if (server.stateService) {
        try {
          agentId = await server.stateService.getProjectAutonomousCopilotAgent(owner, repo) ?? null;
        } catch { /* state service may not be ready */ }
      }

      const sent = server.daemonRegistry!.sendToDaemon(summary.daemonId, {
        type: "workflow:start-coordinator",
        timestamp: Date.now(),
        payload: {
          projectId: summary.daemonId,
          ...(coord.sessionId ? { sessionId: coord.sessionId } : {}),
          ...(agentId ? { agentId } : {}),
        },
      });

      if (sent) {
        server.log.info({ projectId: summary.daemonId, resume: !!coord.sessionId }, "Auto-starting coordinator for daemon");
        server.ws.broadcast("workflow", {
          type: "workflow:coordinator-status-changed",
          projectId: summary.daemonId,
          status: "starting",
        });
      } else {
        const reverted = coordinatorStopped(updated);
        store.setCoordinator(owner, repo, reverted);
      }
    })();
  });

  server.daemonRegistry.on("workflow:coordinator-started", (payload: WorkflowCoordinatorStartedPayload) => {
    const [owner, repo] = payload.projectId.split("/");
    if (!owner || !repo) return;
    const coord = store.getCoordinator(owner, repo);
    const updated = coordinatorStarted(coord, payload.sessionId);
    store.setCoordinator(owner, repo, updated);

    // Browser broadcast (moved from handler.ts)
    server.ws.broadcast("workflow", {
      type: "workflow:coordinator-status-changed",
      projectId: payload.projectId,
      status: "active",
      sessionId: payload.sessionId,
    });

    activityStore.emit({
      type: "coordinator-started",
      projectOwner: owner,
      projectRepo: repo,
      message: `Coordinator started (session ${payload.sessionId.slice(0, 8)}…)`,
      severity: "info",
    });
  });

  server.daemonRegistry.on("workflow:coordinator-crashed", (payload: WorkflowCoordinatorCrashedPayload) => {
    const [owner, repo] = payload.projectId.split("/");
    if (!owner || !repo) return;
    const coord = store.getCoordinator(owner, repo);
    const updated = coordinatorCrashed(coord, payload.error);
    store.setCoordinator(owner, repo, updated);

    // Browser broadcast (moved from handler.ts)
    server.ws.broadcast("workflow", {
      type: "workflow:coordinator-status-changed",
      projectId: payload.projectId,
      status: "crashed",
      error: payload.error,
    });

    activityStore.emit({
      type: "coordinator-crashed",
      projectOwner: owner,
      projectRepo: repo,
      message: `Coordinator crashed: ${payload.error}`,
      severity: "urgent",
    });
  });

  server.daemonRegistry.on("workflow:coordinator-health", (payload: WorkflowCoordinatorHealthPayload) => {
    const [owner, repo] = payload.projectId.split("/");
    if (!owner || !repo) return;
    const coord = store.getCoordinator(owner, repo);
    const updated = coordinatorHealthPing(coord);
    store.setCoordinator(owner, repo, updated);
  });

  server.daemonRegistry.on("workflow:progress", (payload: WorkflowProgressPayload) => {
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

    // Browser broadcast (moved from handler.ts)
    server.ws.broadcast("workflow", {
      type: "workflow:progress",
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      issueNumber: payload.issueNumber,
      eventType: payload.event?.type,
    });

    activityStore.emit({
      type: "progress",
      projectOwner: owner,
      projectRepo: repo,
      issueNumber: payload.issueNumber,
      message: `Progress on issue #${payload.issueNumber}${payload.commits?.length ? ` (${payload.commits.length} commit(s))` : ""}`,
      severity: "info",
    });
  });

  server.daemonRegistry.on("workflow:dispatch-started", (payload: WorkflowDispatchStartedPayload) => {
    const [owner, repo] = payload.projectId.split("/");
    if (!owner || !repo) return;

    // Browser broadcast (moved from handler.ts)
    server.ws.broadcast("workflow", {
      type: "workflow:dispatch-started",
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      issueNumber: payload.issueNumber,
      title: payload.title,
    });

    activityStore.emit({
      type: "issue-dispatched",
      projectOwner: owner,
      projectRepo: repo,
      issueNumber: payload.issueNumber,
      message: `Daemon reported dispatch started for issue #${payload.issueNumber}`,
      severity: "info",
    });
  });

  server.daemonRegistry.on("workflow:issue-completed", (payload: WorkflowIssueCompletedPayload) => {
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

    // Browser broadcast (moved from handler.ts)
    server.ws.broadcast("workflow", {
      type: "workflow:issue-completed",
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      issueNumber: payload.issueNumber,
      summary: payload.summary,
    });

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

  server.daemonRegistry.on("workflow:elicitation-requested", (payload: WorkflowElicitationRequestedPayload) => {
    const [owner, repo] = payload.projectId.split("/");
    if (!owner || !repo) return;

    // Store the pending elicitation
    elicitationStore.add({
      id: payload.elicitationId,
      sessionId: payload.sessionId,
      projectId: payload.projectId,
      message: payload.message,
      requestedSchema: payload.requestedSchema ?? { type: "object", properties: {} },
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

    // Browser broadcast (moved from handler.ts)
    server.ws.broadcast("workflow", {
      type: "workflow:elicitation",
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      elicitationId: payload.elicitationId,
      issueNumber: payload.issueNumber,
      message: payload.message,
      requestedSchema: payload.requestedSchema,
    });

    activityStore.emit({
      type: "elicitation-requested",
      projectOwner: owner,
      projectRepo: repo,
      issueNumber: payload.issueNumber,
      message: `Elicitation requested${payload.issueNumber ? ` for issue #${payload.issueNumber}` : ""}: ${payload.message.slice(0, 100)}`,
      severity: "warning",
    });
  });

  // ── Tool invocation: report_progress(completed) → mark issue done ──

  server.daemonRegistry.on("copilot:tool-invocation", (_daemonId, payload) => {
    if (payload.tool !== "report_progress") return;
    const args = payload.args as Record<string, unknown>;
    if (args.status !== "completed") return;

    const [owner, repo] = (payload.projectId ?? "").split("/");
    if (!owner || !repo) return;

    const coord = store.getCoordinator(owner, repo);
    const active = getActiveDispatches(coord);
    if (active.length === 0) return;

    // Complete the most recent active dispatch
    const dispatch = active[active.length - 1];
    const updatedCoord = updateDispatchStatus(coord, dispatch.issueNumber, "completed");
    store.setCoordinator(owner, repo, updatedCoord);

    // Transition issue to done
    const issue = store.getIssue(owner, repo, dispatch.issueNumber);
    if (issue && issue.state !== "done" && issue.state !== "rejected") {
      try {
        const updated = stateMachine.transition(issue, "done", (args.summary as string) ?? "Completed by coordinator");
        store.updateIssue(owner, repo, updated);
      } catch {
        // Transition may be invalid — ignore
      }
    }

    // Broadcast
    server.ws.broadcast("workflow", {
      type: "workflow:issue-completed",
      projectId: payload.projectId,
      issueNumber: dispatch.issueNumber,
      summary: args.summary,
    });

    activityStore.emit({
      type: "issue-completed",
      projectOwner: owner,
      projectRepo: repo,
      issueNumber: dispatch.issueNumber,
      message: `Issue #${dispatch.issueNumber} completed: ${(args.summary as string)?.slice(0, 100) ?? "done"}`,
      severity: "info",
    });
  });
}
