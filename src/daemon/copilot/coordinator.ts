/**
 * CoordinatorSessionManager — manages a single long-running Copilot SDK
 * session per project configured as an autonomous issue worker.
 *
 * Lifecycle: start → active/idle → (crash → auto-restart with backoff) → stop
 * Health: periodic heartbeats forwarded to HQ via the daemon WebSocket.
 */

import type {
  CoordinatorStatus,
  DaemonToHqMessage,
  SessionEvent,
} from '../../shared/protocol.js';
import type { CopilotManager } from './manager.js';
import { logSdk } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendToHq = (msg: DaemonToHqMessage) => void;

export interface CoordinatorOptions {
  /** Function to forward messages to HQ */
  sendToHq: SendToHq;
  /** CopilotManager that owns SDK sessions */
  copilotManager: CopilotManager;
  /** Project identifier */
  projectId: string;
  /** Human-readable project name */
  projectName?: string;
  /** Health heartbeat interval in ms (default 30 000) */
  healthIntervalMs?: number;
  /** Maximum backoff delay in ms (default 30 000) */
  maxBackoffMs?: number;
}

export interface CoordinatorSnapshot {
  state: CoordinatorStatus;
  sessionId: string | null;
  startedAt: number | null;
  dispatched: number;
  completed: number;
  restartCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HEALTH_INTERVAL_MS = 30_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

const COORDINATOR_SYSTEM_MESSAGE = `You are an autonomous issue worker managed by launchpad-hq.
Your job is to receive GitHub issues and work on them independently.
For each issue dispatched to you:
1. Analyze the issue title, body, and labels
2. Plan your approach
3. Implement the solution using available tools
4. Report progress via report_progress tool
5. When done, use report_progress with status "completed"
6. If blocked, use report_blocker to signal the operator
7. When important decisions need to be made, request_human_review to ask the operator for input

Always keep the operator informed of your progress and any blockers you encounter.`;

// ---------------------------------------------------------------------------
// CoordinatorSessionManager
// ---------------------------------------------------------------------------

export class CoordinatorSessionManager {
  private sendToHq: SendToHq;
  private copilotManager: CopilotManager;
  private projectId: string;
  private projectName?: string;
  private healthIntervalMs: number;
  private maxBackoffMs: number;

  private _state: CoordinatorStatus = 'stopped';
  private _sessionId: string | null = null;
  private _startedAt: number | null = null;
  private _dispatched = 0;
  private _completed = 0;
  private _restartCount = 0;
  private _consecutiveFailures = 0;

  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private eventUnsub: (() => void) | null = null;
  private stopped = false;

  constructor(options: CoordinatorOptions) {
    this.sendToHq = options.sendToHq;
    this.copilotManager = options.copilotManager;
    this.projectId = options.projectId;
    this.projectName = options.projectName;
    this.healthIntervalMs = options.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  /** Current coordinator state */
  get state(): CoordinatorStatus {
    return this._state;
  }

  /** Active session ID (null when stopped/crashed) */
  get sessionId(): string | null {
    return this._sessionId;
  }

  /** Full status snapshot */
  get status(): CoordinatorSnapshot {
    return {
      state: this._state,
      sessionId: this._sessionId,
      startedAt: this._startedAt,
      dispatched: this._dispatched,
      completed: this._completed,
      restartCount: this._restartCount,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start a new coordinator session, or resume an existing one.
   * @param resumeSessionId — optional sessionId to resume instead of creating new
   */
  async start(resumeSessionId?: string): Promise<void> {
    if (this._state === 'active' || this._state === 'starting') {
      return; // already running
    }

    this.stopped = false;
    this.setState('starting');

    // Wait for CopilotManager to be ready (may still be starting)
    for (let i = 0; i < 20 && !this.copilotManager.isReady; i++) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (!this.copilotManager.isReady) {
      this.handleCrash('CopilotManager not ready after 10s');
      return;
    }

    try {
      let sessionId: string;
      if (resumeSessionId) {
        try {
          sessionId = await this.resumeSession(resumeSessionId);
        } catch (err) {
          // Resume failed (session not found on disk) — create fresh
          logSdk(`Resume failed for ${resumeSessionId}, creating new session: ${err}`);
          sessionId = await this.createSession();
        }
      } else {
        sessionId = await this.createSession();
      }

      this._sessionId = sessionId;
      this._startedAt = Date.now();
      this._consecutiveFailures = 0;
      this.setState('active');

      this.sendToHq({
        type: 'workflow:coordinator-started',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          resumed: !!resumeSessionId,
        },
      });

      this.startHealthMonitor();
      logSdk(`Coordinator session started: ${sessionId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.handleCrash(message);
    }
  }

  /** Stop the coordinator session cleanly */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();

    if (this._sessionId) {
      logSdk(`Coordinator session stopping: ${this._sessionId}`);
    }

    this.eventUnsub?.();
    this.eventUnsub = null;
    // Preserve _sessionId for resume — don't null it
    this._startedAt = null;
    this.setState('stopped');
  }

  /** Record that a dispatched issue was completed */
  recordCompletion(): void {
    this._completed += 1;
  }

  /** Record that a new issue was dispatched */
  recordDispatch(): void {
    this._dispatched += 1;
  }

  // -----------------------------------------------------------------------
  // Internal — session creation
  // -----------------------------------------------------------------------

  private async createSession(): Promise<string> {
    // Use the CopilotManager's handleMessage to create a session with
    // coordinator-specific system message. We generate a requestId to
    // correlate the response event.
    const requestId = `coordinator-${Date.now()}`;

    const sessionId = await this.copilotManager.createCoordinatorSession({
      requestId,
      systemMessage: {
        mode: 'replace',
        content: this.buildSystemMessage(),
      },
    });

    return sessionId;
  }

  private async resumeSession(sessionId: string): Promise<string> {
    const requestId = `coordinator-resume-${Date.now()}`;

    await this.copilotManager.resumeCoordinatorSession({
      requestId,
      sessionId,
      systemMessage: {
        mode: 'replace',
        content: this.buildSystemMessage(),
      },
    });

    return sessionId;
  }

  private buildSystemMessage(): string {
    const projectContext = this.projectName
      ? `Project: "${this.projectName}" (${this.projectId})`
      : `Project: ${this.projectId}`;

    return `${COORDINATOR_SYSTEM_MESSAGE}\n\n${projectContext}`;
  }

  // -----------------------------------------------------------------------
  // Internal — health monitoring
  // -----------------------------------------------------------------------

  private startHealthMonitor(): void {
    this.clearHealthTimer();

    this.healthTimer = setInterval(() => {
      if (this._state !== 'active' && this._state !== 'idle') return;

      this.sendToHq({
        type: 'workflow:coordinator-health',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId: this._sessionId!,
          state: this._state,
          uptimeMs: this._startedAt ? Date.now() - this._startedAt : 0,
          dispatched: this._dispatched,
          completed: this._completed,
        },
      });
    }, this.healthIntervalMs);
  }

  // -----------------------------------------------------------------------
  // Internal — crash handling & auto-restart
  // -----------------------------------------------------------------------

  private handleCrash(error: string): void {
    this._consecutiveFailures += 1;
    this.setState('crashed');

    const willRetry = !this.stopped;
    this.sendToHq({
      type: 'workflow:coordinator-crashed',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId: this._sessionId,
        error,
        willRetry,
        retryAttempt: this._consecutiveFailures,
      },
    });

    logSdk(`Coordinator crashed (attempt ${this._consecutiveFailures}): ${error}`);

    if (willRetry) {
      this.scheduleRestart();
    }
  }

  private scheduleRestart(): void {
    const delay = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, this._consecutiveFailures - 1),
      this.maxBackoffMs,
    );

    logSdk(`Coordinator restart scheduled in ${delay}ms`);
    this.restartTimer = setTimeout(() => {
      this._restartCount += 1;
      void this.start();
    }, delay);
  }

  /** Compute the backoff delay (exposed for testing) */
  getBackoffDelay(): number {
    return Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, this._consecutiveFailures - 1),
      this.maxBackoffMs,
    );
  }

  // -----------------------------------------------------------------------
  // Progress event forwarding
  // -----------------------------------------------------------------------

  /**
   * Forward a session event as workflow progress for a specific issue.
   * Called by the dispatch module when events arrive for dispatched work.
   */
  forwardProgressEvent(issueNumber: number, event: SessionEvent): void {
    if (!this._sessionId) return;

    this.sendToHq({
      type: 'workflow:progress',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId: this._sessionId,
        issueNumber,
        event,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private setState(state: CoordinatorStatus): void {
    this._state = state;
  }

  private clearTimers(): void {
    this.clearHealthTimer();
    this.clearRestartTimer();
  }

  private clearHealthTimer(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}
