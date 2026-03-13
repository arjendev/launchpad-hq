/**
 * CopilotManager — thin wrapper around @github/copilot-sdk.
 *
 * Responsibilities:
 *  • Creates CopilotClient directly (no adapter)
 *  • Forwards SDK session events as-is to HQ — no mapping, no renaming
 *  • Handles incoming HQ commands (create/resume/send/abort/list)
 *  • Periodically polls listSessions() and sends SessionMetadata[] to HQ
 *  • Tracks active sessions for cleanup on shutdown
 */

import { randomUUID } from 'node:crypto';
import type {
  ConnectionState,
  SessionEvent,
  SessionMetadata,
  Tool,
} from '@github/copilot-sdk';
import type {
  DaemonToHqMessage,
  HqToDaemonMessage,
  SessionConfigWire,
} from '../../shared/protocol.js';
import { createHqTools } from './hq-tools.js';
import { buildSystemMessage } from './system-message.js';

// ---------------------------------------------------------------------------
// SDK dynamic import — safe when package is not installed
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CopilotClientClass: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkApproveAll: any = null;

try {
  const sdk = await import('@github/copilot-sdk');
  CopilotClientClass = sdk.CopilotClient;
  sdkApproveAll = sdk.approveAll;
} catch {
  // SDK import failed — start() will warn and skip copilot features
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendToHq = (msg: DaemonToHqMessage) => void;

export interface CopilotManagerOptions {
  /** Function to send messages to HQ over the daemon WebSocket */
  sendToHq: SendToHq;
  /** Project identifier for this daemon */
  projectId?: string;
  /** Human-readable project name */
  projectName?: string;
  /** Working directory (defaults to process.cwd()) */
  cwd?: string;
  /** Session-list poll interval in ms (default 30 000) */
  pollIntervalMs?: number;
  /** Override client for testing (duck-typed CopilotClient) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal synthetic SessionEvent for daemon-originated notifications */
function syntheticEvent(type: string, data: Record<string, unknown>): SessionEvent {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    parentId: null,
    type,
    data,
  } as SessionEvent;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class CopilotManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private sendToHq: SendToHq;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private activeSessions = new Map<string, any>();
  private sessionUnsubscribers = new Map<string, () => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private lifecycleUnsub: (() => void) | null = null;
  private projectId: string;
  private projectName?: string;
  private hqTools: Tool[];
  private started = false;

  constructor(options: CopilotManagerOptions) {
    this.sendToHq = options.sendToHq;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.projectId = options.projectId ?? 'unknown';
    this.projectName = options.projectName;

    this.hqTools = createHqTools(this.sendToHq, this.projectId);

    if (options.client) {
      this.client = options.client;
    } else if (CopilotClientClass) {
      this.client = new CopilotClientClass({
        cwd: options.cwd ?? process.cwd(),
        autoRestart: true,
        autoStart: false,
        logLevel: 'warning',
      });
    }
  }

  /** Start the SDK client and begin polling sessions */
  async start(): Promise<void> {
    if (!this.client) {
      console.warn('⚠ Copilot SDK not available — copilot features disabled');
      return;
    }

    // Wire client-level lifecycle events (session created/deleted/updated)
    if (typeof this.client.on === 'function') {
      this.lifecycleUnsub = this.client.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (event: any) => {
          if (event.sessionId) {
            this.sendToHq({
              type: 'copilot-session-event',
              timestamp: Date.now(),
              payload: {
                projectId: this.projectId,
                sessionId: event.sessionId,
                event: syntheticEvent(event.type, { sessionId: event.sessionId, metadata: event.metadata }),
              },
            });
          }
        },
      );
    }

    this.sendConnectionState('connecting');

    try {
      await this.client.start();
      this.started = true;
      this.sendConnectionState(this.client.getState());
    } catch (err) {
      this.sendConnectionState('error');
      console.warn(
        `⚠ Copilot SDK failed to start — copilot features unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    // Initial session list
    await this.pollSessions('initial');

    // Periodic poll
    this.pollTimer = setInterval(() => {
      void this.pollSessions('poll');
    }, this.pollIntervalMs);
  }

  /** Shut down cleanly */
  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Disconnect all tracked sessions
    for (const [id, session] of this.activeSessions) {
      const unsub = this.sessionUnsubscribers.get(id);
      if (unsub) unsub();
      try {
        await session.disconnect();
      } catch {
        // session may already be disconnected
      }
    }
    this.activeSessions.clear();
    this.sessionUnsubscribers.clear();

    this.lifecycleUnsub?.();
    this.lifecycleUnsub = null;

    if (this.started && this.client) {
      try {
        await this.client.stop();
      } catch {
        await this.client.forceStop().catch(() => {});
      }
      this.started = false;
    }
  }

  /** Handle an incoming HQ → Daemon message (copilot-* commands) */
  async handleMessage(msg: HqToDaemonMessage): Promise<void> {
    switch (msg.type) {
      case 'copilot-create-session':
        await this.handleCreateSession(msg.payload.requestId, msg.payload.config);
        break;

      case 'copilot-resume-session':
        await this.handleResumeSession(
          msg.payload.requestId,
          msg.payload.sessionId,
          msg.payload.config,
        );
        break;

      case 'copilot-send-prompt':
        await this.handleSendPrompt(
          msg.payload.sessionId,
          msg.payload.prompt,
          msg.payload.attachments,
        );
        break;

      case 'copilot-abort-session':
        await this.handleAbort(msg.payload.sessionId);
        break;

      case 'copilot-list-sessions':
        await this.pollSessions(msg.payload.requestId);
        break;

      default:
        // Not a copilot command — ignore
        break;
    }
  }

  /** Expose the current SDK connection state */
  get connectionState(): ConnectionState {
    if (!this.client) return 'disconnected';
    return this.client.getState() as ConnectionState;
  }

  // -----------------------------------------------------------------------
  // Command handlers
  // -----------------------------------------------------------------------

  private async handleCreateSession(
    requestId: string,
    config?: SessionConfigWire,
  ): Promise<void> {
    try {
      const sdkConfig = this.buildSdkConfig(config);
      const session = await this.client.createSession(sdkConfig);
      this.trackSession(session);

      // SDK will emit session.start via the event handler, but we also send
      // a synthetic event so HQ can correlate the requestId
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId: session.sessionId,
          event: syntheticEvent('session.start', { requestId, sessionId: session.sessionId }),
        },
      });
    } catch (err) {
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId: 'unknown',
          event: syntheticEvent('session.error', { requestId, message: String(err) }),
        },
      });
    }
  }

  private async handleResumeSession(
    requestId: string,
    sessionId: string,
    config?: Partial<SessionConfigWire>,
  ): Promise<void> {
    try {
      const sdkConfig = this.buildSdkConfig(config as SessionConfigWire | undefined);
      const session = await this.client.resumeSession(sessionId, sdkConfig);
      this.trackSession(session);

      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId: session.sessionId,
          event: syntheticEvent('session.start', { requestId, resumed: true }),
        },
      });
    } catch (err) {
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          event: syntheticEvent('session.error', { requestId, message: String(err) }),
        },
      });
    }
  }

  private async handleSendPrompt(
    sessionId: string,
    prompt: string,
    attachments?: Array<{ type: string; path: string }>,
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          event: syntheticEvent('session.error', { message: `No active session: ${sessionId}` }),
        },
      });
      return;
    }

    try {
      // Fire-and-forget: events stream back via session.on() handler
      await session.send({ prompt, attachments });
    } catch (err) {
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          event: syntheticEvent('session.error', { message: String(err) }),
        },
      });
    }
  }

  private async handleAbort(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      await session.abort();
      await session.disconnect();

      const unsub = this.sessionUnsubscribers.get(sessionId);
      if (unsub) unsub();
      this.sessionUnsubscribers.delete(sessionId);
      this.activeSessions.delete(sessionId);
    }

    // Always try to delete from SDK registry
    if (this.client && this.started) {
      try {
        await this.client.deleteSession(sessionId);
      } catch {
        // session may not exist in registry
      }
    }

    // Notify HQ so aggregator can clean up
    this.sendToHq({
      type: 'copilot-session-event',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId,
        event: syntheticEvent('session.shutdown', { sessionId, reason: 'aborted' }),
      },
    });
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Track a session and forward its events to HQ as-is */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private trackSession(session: any): void {
    this.activeSessions.set(session.sessionId, session);

    const unsub = session.on((event: SessionEvent) => {
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId: session.sessionId,
          event, // SDK event as-is — NO mapping!
        },
      });
    });

    this.sessionUnsubscribers.set(session.sessionId, unsub);
  }

  private async pollSessions(requestId: string): Promise<void> {
    if (!this.client || !this.started) return;
    try {
      const sessions: SessionMetadata[] = await this.client.listSessions();
      this.sendToHq({
        type: 'copilot-session-list',
        timestamp: Date.now(),
        payload: { projectId: this.projectId, requestId, sessions },
      });
    } catch (err) {
      console.warn(`⚠ Session poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private sendConnectionState(state: ConnectionState): void {
    this.sendToHq({
      type: 'copilot-sdk-state',
      timestamp: Date.now(),
      payload: { state },
    });
  }

  /** Build a full SDK SessionConfig from a wire config + HQ injections */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildSdkConfig(wire?: SessionConfigWire): any {
    const config = wire ?? {};
    return {
      ...(config.model && { model: config.model }),
      ...(config.streaming !== undefined && { streaming: config.streaming }),
      systemMessage: config.systemMessage ?? buildSystemMessage(this.projectId, this.projectName),
      tools: [...this.hqTools],
      onPermissionRequest: sdkApproveAll,
    };
  }
}
