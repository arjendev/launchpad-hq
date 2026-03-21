/**
 * Typed event bus for daemon registry.
 *
 * Replaces raw EventEmitter abuse with a proper event map so consumers
 * can emit/listen without `as never` casts.
 */

import { EventEmitter } from "node:events";
import type { DaemonSummary } from "./registry.js";

// ── Workflow event payloads ──────────────────────────────

export interface WorkflowCoordinatorStartedPayload {
  projectId: string;
  sessionId: string;
}

export interface WorkflowCoordinatorCrashedPayload {
  projectId: string;
  error: string;
}

export interface WorkflowCoordinatorHealthPayload {
  projectId: string;
  sessionId: string;
}

export interface WorkflowProgressPayload {
  projectId: string;
  sessionId: string;
  issueNumber: number;
  event: { type: string };
  commits?: Array<{ sha: string; message: string; author?: string }>;
}

export interface WorkflowDispatchStartedPayload {
  projectId: string;
  sessionId: string;
  issueNumber: number;
  title: string;
}

export interface WorkflowIssueCompletedPayload {
  projectId: string;
  sessionId: string;
  issueNumber: number;
  summary?: string;
  commits?: Array<{ sha: string; message: string; author?: string }>;
}

export interface WorkflowElicitationRequestedPayload {
  projectId: string;
  sessionId: string;
  elicitationId: string;
  issueNumber?: number;
  message: string;
  requestedSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

// ── Complete event map ───────────────────────────────────

export interface DaemonEventMap {
  // Daemon lifecycle (already typed in registry)
  "daemon:connected": [daemon: DaemonSummary];
  "daemon:disconnected": [daemon: DaemonSummary];

  // Copilot events (daemonId, payload)
  "copilot:session-list": [daemonId: string | undefined, payload: { projectId: string; requestId?: string; sessions: unknown[] }];
  "copilot:session-event": [daemonId: string | undefined, payload: { projectId: string; sessionId: string; sessionType?: unknown; event: unknown }];
  "copilot:agent-catalog": [daemonId: string | undefined, payload: { projectId: string; agents: unknown[] }];
  "copilot:sdk-state": [daemonId: string | undefined, payload: { projectId: string; state: unknown; error?: string }];
  "copilot:tool-invocation": [daemonId: string | undefined, payload: { sessionId: string; projectId: string; tool: string; args: unknown; timestamp: number }];
  "copilot:conversation": [projectId: string, payload: { projectId: string; sessionId: string; messages: unknown[] }];
  "copilot:models-list": [daemonId: string | undefined, payload: { requestId?: string; models: unknown[] }];
  "copilot:mode-response": [daemonId: string | undefined, payload: { requestId: string; sessionId: string; mode: string }];
  "copilot:agent-response": [daemonId: string | undefined, payload: { requestId: string; sessionId: string; agentId: string | null; agentName: string | null; error?: string }];
  "copilot:plan-response": [daemonId: string | undefined, payload: { requestId: string; sessionId: string; plan: { exists: boolean; content: string | null; path: string | null } }];

  // Preview events (payload only)
  "preview:proxy-response": [payload: unknown];
  "preview:ws-data": [payload: unknown];
  "preview:ws-close": [payload: unknown];

  // Workflow events (payload only)
  "workflow:coordinator-started": [payload: WorkflowCoordinatorStartedPayload];
  "workflow:coordinator-crashed": [payload: WorkflowCoordinatorCrashedPayload];
  "workflow:coordinator-health": [payload: WorkflowCoordinatorHealthPayload];
  "workflow:progress": [payload: WorkflowProgressPayload];
  "workflow:dispatch-started": [payload: WorkflowDispatchStartedPayload];
  "workflow:issue-completed": [payload: WorkflowIssueCompletedPayload];
  "workflow:elicitation-requested": [payload: WorkflowElicitationRequestedPayload];
}

// ── Typed EventEmitter ───────────────────────────────────

/**
 * Interface that provides typed emit/on/once/removeListener overloads.
 * Merged with the DaemonEventBus class via declaration merging.
 */
export interface DaemonEventBus {
  on<K extends keyof DaemonEventMap & string>(event: K, listener: (...args: DaemonEventMap[K]) => void): this;
  once<K extends keyof DaemonEventMap & string>(event: K, listener: (...args: DaemonEventMap[K]) => void): this;
  emit<K extends keyof DaemonEventMap & string>(event: K, ...args: DaemonEventMap[K]): boolean;
  removeListener<K extends keyof DaemonEventMap & string>(event: K, listener: (...args: DaemonEventMap[K]) => void): this;
  removeAllListeners<K extends keyof DaemonEventMap & string>(event?: K): this;
}

/**
 * Base class for DaemonRegistry. Extends EventEmitter with typed overloads
 * so callers don't need `as never` casts for known event names.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class DaemonEventBus extends EventEmitter {}
