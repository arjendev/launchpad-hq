/**
 * SDK Queue Dispatch — sends issue work to a coordinator session.
 *
 * Formats issue data into a prompt, dispatches it to the active coordinator
 * session via CopilotManager.sendToSession(), and tracks which issues
 * are dispatched to which sessions.
 */

import type {
  DaemonToHqMessage,
  DispatchStatus,
  WorkflowIssuePayload,
} from '../../shared/protocol.js';
import type { CoordinatorSessionManager } from './coordinator.js';
import type { CopilotManager } from './manager.js';
import { logSdk } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendToHq = (msg: DaemonToHqMessage) => void;

export type { DispatchStatus } from '../../shared/protocol.js';

export interface DispatchedIssue {
  issue: WorkflowIssuePayload;
  sessionId: string;
  status: DispatchStatus;
  dispatchedAt: number;
  completedAt?: number;
}

export interface DispatchResult {
  success: boolean;
  issueNumber: number;
  sessionId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// IssueDispatcher
// ---------------------------------------------------------------------------

export class IssueDispatcher {
  private sendToHq: SendToHq;
  private copilotManager: CopilotManager;
  private coordinator: CoordinatorSessionManager;
  private projectId: string;

  /** Map of issueNumber → dispatch tracking info */
  private dispatched = new Map<number, DispatchedIssue>();

  constructor(opts: {
    sendToHq: SendToHq;
    copilotManager: CopilotManager;
    coordinator: CoordinatorSessionManager;
    projectId: string;
  }) {
    this.sendToHq = opts.sendToHq;
    this.copilotManager = opts.copilotManager;
    this.coordinator = opts.coordinator;
    this.projectId = opts.projectId;
  }

  /**
   * Dispatch an issue to the coordinator session.
   * Sends a formatted prompt with the issue details.
   */
  async dispatchIssue(issue: WorkflowIssuePayload): Promise<DispatchResult> {
    const sessionId = this.coordinator.sessionId;

    if (!sessionId) {
      return {
        success: false,
        issueNumber: issue.issueNumber,
        error: 'No active coordinator session',
      };
    }

    if (this.coordinator.state !== 'active' && this.coordinator.state !== 'idle') {
      return {
        success: false,
        issueNumber: issue.issueNumber,
        error: `Coordinator is in state "${this.coordinator.state}", cannot dispatch`,
      };
    }

    const prompt = this.formatIssuePrompt(issue);

    try {
      const sent = await this.copilotManager.sendToSession(sessionId, prompt);
      if (!sent) {
        return {
          success: false,
          issueNumber: issue.issueNumber,
          sessionId,
          error: 'Session not found in active sessions',
        };
      }

      const entry: DispatchedIssue = {
        issue,
        sessionId,
        status: 'dispatched',
        dispatchedAt: Date.now(),
      };
      this.dispatched.set(issue.issueNumber, entry);

      this.coordinator.recordDispatch();

      this.sendToHq({
        type: 'workflow:dispatch-started',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          issueNumber: issue.issueNumber,
          title: issue.title,
        },
      });

      logSdk(`Issue #${issue.issueNumber} dispatched to session ${sessionId}`);

      return {
        success: true,
        issueNumber: issue.issueNumber,
        sessionId,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logSdk(`Issue #${issue.issueNumber} dispatch failed: ${error}`);
      return {
        success: false,
        issueNumber: issue.issueNumber,
        sessionId,
        error,
      };
    }
  }

  /**
   * Mark an issue as completed by the coordinator.
   */
  markCompleted(issueNumber: number, summary: string): void {
    const entry = this.dispatched.get(issueNumber);
    if (entry) {
      entry.status = 'completed';
      entry.completedAt = Date.now();
    }

    this.coordinator.recordCompletion();

    const sessionId = this.coordinator.sessionId;
    if (sessionId) {
      this.sendToHq({
        type: 'workflow:issue-completed',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          issueNumber,
          summary,
        },
      });
    }
  }

  /**
   * Mark an issue dispatch as failed.
   */
  markFailed(issueNumber: number): void {
    const entry = this.dispatched.get(issueNumber);
    if (entry) {
      entry.status = 'failed';
    }
  }

  /** Get the status of a dispatched issue */
  getDispatchStatus(issueNumber: number): DispatchedIssue | undefined {
    return this.dispatched.get(issueNumber);
  }

  /** Get all dispatched issues */
  getAllDispatched(): ReadonlyMap<number, DispatchedIssue> {
    return this.dispatched;
  }

  /** Get count of currently dispatched (in-flight) issues */
  get activeCount(): number {
    let count = 0;
    for (const entry of this.dispatched.values()) {
      if (entry.status === 'dispatched') count += 1;
    }
    return count;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private formatIssuePrompt(issue: WorkflowIssuePayload): string {
    const parts: string[] = [
      `## Work on Issue #${issue.issueNumber}: ${issue.title}`,
      '',
    ];

    if (issue.labels.length > 0) {
      parts.push(`**Labels:** ${issue.labels.join(', ')}`);
      parts.push('');
    }

    parts.push('### Issue Body');
    parts.push(issue.body || '_No description provided._');

    if (issue.feedback) {
      parts.push('');
      parts.push('### Prior Feedback');
      parts.push(issue.feedback);
    }

    parts.push('');
    parts.push('---');
    parts.push('Please work on this issue. Use `report_progress` to update your status.');
    parts.push('When complete, use `report_progress` with status "completed".');

    return parts.join('\n');
  }
}
