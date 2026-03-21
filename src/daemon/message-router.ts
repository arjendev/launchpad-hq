/**
 * MessageRouter — single entry point for all HQ → Daemon messages.
 *
 * Replaces the scattered `client.on('message')` handlers in index.ts
 * with a single router that dispatches by message type prefix or exact match.
 */

import type { HqToDaemonMessage } from '../shared/protocol.js';
import type { DaemonWebSocketClient } from './client.js';
import type { DaemonState } from './state.js';
import type { CopilotManager } from './copilot/manager.js';
import type { CliSessionManager } from './copilot-cli/index.js';
import type { CoordinatorSessionManager } from './copilot/coordinator.js';
import type { IssueDispatcher } from './copilot/dispatch.js';
import type { PreviewManager } from './preview-manager.js';
import { logIncoming } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageRouterDeps {
  client: DaemonWebSocketClient;
  state: DaemonState;
  copilot: CopilotManager;
  cliSessions: CliSessionManager;
  coordinator: CoordinatorSessionManager;
  issueDispatcher: IssueDispatcher;
  previewManager: PreviewManager;
}

// ---------------------------------------------------------------------------
// MessageRouter
// ---------------------------------------------------------------------------

export class MessageRouter {
  private client: DaemonWebSocketClient;
  private state: DaemonState;
  private copilot: CopilotManager;
  private cliSessions: CliSessionManager;
  private coordinator: CoordinatorSessionManager;
  private issueDispatcher: IssueDispatcher;
  private previewManager: PreviewManager;

  constructor(deps: MessageRouterDeps) {
    this.client = deps.client;
    this.state = deps.state;
    this.copilot = deps.copilot;
    this.cliSessions = deps.cliSessions;
    this.coordinator = deps.coordinator;
    this.issueDispatcher = deps.issueDispatcher;
    this.previewManager = deps.previewManager;
  }

  /**
   * Handle a single incoming HQ message.
   * Dispatches to the correct handler by type.
   */
  async handleMessage(msg: HqToDaemonMessage): Promise<void> {
    // --- Status request ---
    if (msg.type === 'request-status') {
      logIncoming(msg.type, msg.payload);
      this.client.sendStatusUpdate(this.state.current);
      return;
    }

    // --- Preview messages ---
    if (msg.type.startsWith('preview-')) {
      this.previewManager.handleMessage(msg);
      return;
    }

    // --- Coordinator lifecycle ---
    if (msg.type === 'workflow:start-coordinator') {
      const payload = msg.payload as { projectId: string; sessionId?: string; agentId?: string | null };
      void this.coordinator.start(payload.sessionId, payload.agentId).catch((err) => {
        console.error(`⚠ Coordinator start failed: ${err}`);
      });
      return;
    }
    if (msg.type === 'workflow:stop-coordinator') {
      void this.coordinator.stop().catch((err) => {
        console.error(`⚠ Coordinator stop failed: ${err}`);
      });
      return;
    }

    // --- Issue dispatch ---
    if (msg.type === 'workflow:dispatch-issue') {
      const payload = msg.payload as { projectId: string; issueNumber: number; title: string; labels?: string[] };
      void this.issueDispatcher.dispatchIssue({
        issueNumber: payload.issueNumber,
        title: payload.title,
        body: "",
        labels: payload.labels ?? [],
      }).catch((err) => {
        console.error(`⚠ Issue dispatch failed for #${payload.issueNumber}: ${err}`);
      });
      return;
    }

    // --- Copilot / terminal / elicitation messages ---
    if (!msg.type.startsWith('copilot-') && !msg.type.startsWith('terminal-') && !msg.type.startsWith('workflow:elicitation-')) return;

    // Try CLI session manager first (handles its own sessions + copilot-cli type)
    const handledByCli = await this.cliSessions.handleMessage(msg);
    if (handledByCli) return;

    // Fall through to default CopilotManager (copilot-sdk type + elicitation responses)
    if (msg.type.startsWith('copilot-') || msg.type === 'workflow:elicitation-response') {
      void this.copilot.handleMessage(msg);
    }
  }
}
