/**
 * Workflow plugin — service instantiation, Fastify decoration, and event wiring.
 *
 * Must be registered BEFORE routes/workflow.ts so that decorators
 * (workflowStore, workflowStateMachine, elicitationStore, activityStore)
 * are available when route handlers run.
 */

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
  WorkflowStateMachine,
  type WorkflowEvent,
} from "./state-machine.js";
import { WorkflowStore } from "./store.js";
import { ElicitationStore } from "./elicitation-store.js";
import { ActivityStore } from "./activity-store.js";
import { registerWorkflowDaemonEvents } from "./daemon-events.js";

declare module "fastify" {
  interface FastifyInstance {
    workflowStore: WorkflowStore;
    workflowStateMachine: WorkflowStateMachine;
    elicitationStore: ElicitationStore;
    activityStore: ActivityStore;
  }
}

async function workflowPlugin(server: FastifyInstance) {
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

  // Wire up daemon event listeners for workflow
  registerWorkflowDaemonEvents(server);

  // Flush on shutdown
  server.addHook("onClose", async () => {
    elicitationStore.close();
    await store.close();
  });
}

export default fp(workflowPlugin, {
  name: "workflow",
});
