/**
 * CopilotManager — orchestrates the Copilot SDK adapter within the daemon.
 *
 * Responsibilities:
 *  • Creates the SDK adapter (or accepts an injected adapter for testing)
 *  • Forwards adapter state changes to HQ via `copilot-sdk-state`
 *  • Handles incoming HQ commands (create/resume/send/abort/list)
 *  • Relays session events to HQ as `copilot-sdk-session-event`
 *  • Periodically polls `listSessions()` and sends to HQ
 *  • Tracks active sessions for cleanup on shutdown
 */

import type { DaemonToHqMessage, HqToDaemonMessage, SessionConfigWire } from '../../shared/protocol.js';
import type { CopilotAdapter, CopilotSession, SessionConfig, ToolDefinition } from './adapter.js';
import { SdkCopilotAdapter } from './sdk-adapter.js';
import { createHqTools } from './hq-tools.js';
import { buildSystemMessage } from './system-message.js';

export type SendToHq = (msg: DaemonToHqMessage) => void;

/** Convert wire-safe config to adapter SessionConfig (tools have no handlers over the wire) */
function toSessionConfig(wire?: SessionConfigWire): SessionConfig {
  if (!wire) return {};
  const { tools: _tools, ...rest } = wire;
  return rest;
}

export interface CopilotManagerOptions {
  /** Function to send messages to HQ over the daemon WebSocket */
  sendToHq: SendToHq;
  /** Project identifier for this daemon */
  projectId?: string;
  /** Human-readable project name */
  projectName?: string;
  /** Override adapter for testing (defaults to SdkCopilotAdapter) */
  adapter?: CopilotAdapter;
  /** Session-list poll interval in ms (default 30 000) */
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

export class CopilotManager {
  private adapter: CopilotAdapter;
  private sendToHq: SendToHq;
  private activeSessions = new Map<string, CopilotSession>();
  private sessionUnsubscribers = new Map<string, () => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private stateUnsub: (() => void) | null = null;
  private projectId: string;
  private projectName?: string;
  private hqTools: ToolDefinition[];

  constructor(options: CopilotManagerOptions) {
    this.sendToHq = options.sendToHq;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.projectId = options.projectId ?? 'unknown';
    this.projectName = options.projectName;

    this.hqTools = createHqTools(this.sendToHq, this.projectId);

    this.adapter = options.adapter ?? new SdkCopilotAdapter({ cwd: process.cwd() });
  }

  /** Start the adapter and begin polling sessions */
  async start(): Promise<void> {
    this.stateUnsub = this.adapter.onStateChange((state) => {
      this.sendToHq({
        type: 'copilot-sdk-state',
        timestamp: Date.now(),
        payload: { state },
      });
    });

    try {
      await this.adapter.start();
    } catch (err) {
      // SDK failed (e.g. Copilot CLI not in PATH) — copilot features unavailable
      // but the daemon keeps running without copilot capability
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

    // Destroy all tracked sessions
    for (const [id, session] of this.activeSessions) {
      const unsub = this.sessionUnsubscribers.get(id);
      if (unsub) unsub();
      await session.destroy();
    }
    this.activeSessions.clear();
    this.sessionUnsubscribers.clear();

    this.stateUnsub?.();
    this.stateUnsub = null;

    await this.adapter.stop();
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

  /** Expose the current adapter state */
  get adapterState() {
    return this.adapter.state;
  }

  // -----------------------------------------------------------------------
  // Command handlers
  // -----------------------------------------------------------------------

  private async handleCreateSession(
    requestId: string,
    config?: SessionConfigWire,
  ): Promise<void> {
    try {
      const sessionConfig = this.injectHqConfig(toSessionConfig(config));
      const session = await this.adapter.createSession(sessionConfig);
      this.trackSession(session);

      this.sendToHq({
        type: 'copilot-sdk-session-event',
        timestamp: Date.now(),
        payload: {
          sessionId: session.sessionId,
          event: {
            type: 'session.start',
            data: { requestId },
            timestamp: Date.now(),
          },
        },
      });
    } catch (err) {
      this.sendToHq({
        type: 'copilot-sdk-session-event',
        timestamp: Date.now(),
        payload: {
          sessionId: 'unknown',
          event: {
            type: 'session.error',
            data: { requestId, error: String(err) },
            timestamp: Date.now(),
          },
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
      const sessionConfig = this.injectHqConfig(toSessionConfig(config as SessionConfigWire | undefined));
      const session = await this.adapter.resumeSession(sessionId, sessionConfig);
      this.trackSession(session);

      this.sendToHq({
        type: 'copilot-sdk-session-event',
        timestamp: Date.now(),
        payload: {
          sessionId: session.sessionId,
          event: {
            type: 'session.start',
            data: { requestId, resumed: true },
            timestamp: Date.now(),
          },
        },
      });
    } catch (err) {
      this.sendToHq({
        type: 'copilot-sdk-session-event',
        timestamp: Date.now(),
        payload: {
          sessionId,
          event: {
            type: 'session.error',
            data: { requestId, error: String(err) },
            timestamp: Date.now(),
          },
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
        type: 'copilot-sdk-session-event',
        timestamp: Date.now(),
        payload: {
          sessionId,
          event: {
            type: 'session.error',
            data: { error: `No active session: ${sessionId}` },
            timestamp: Date.now(),
          },
        },
      });
      return;
    }

    try {
      await session.send({ prompt, attachments });
    } catch (err) {
      this.sendToHq({
        type: 'copilot-sdk-session-event',
        timestamp: Date.now(),
        payload: {
          sessionId,
          event: {
            type: 'session.error',
            data: { error: String(err) },
            timestamp: Date.now(),
          },
        },
      });
    }
  }

  private async handleAbort(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      await session.abort();

      // Unsubscribe from session events
      const unsub = this.sessionUnsubscribers.get(sessionId);
      if (unsub) unsub();
      this.sessionUnsubscribers.delete(sessionId);

      // Remove from active sessions
      this.activeSessions.delete(sessionId);

      // Notify HQ so aggregator can clean up if it hasn't already
      this.sendToHq({
        type: 'copilot-sdk-session-event',
        timestamp: Date.now(),
        payload: {
          sessionId,
          event: {
            type: 'session.ended',
            data: {},
            timestamp: Date.now(),
          },
        },
      });
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private trackSession(session: CopilotSession): void {
    this.activeSessions.set(session.sessionId, session);

    const unsub = session.on((event) => {
      this.sendToHq({
        type: 'copilot-sdk-session-event',
        timestamp: Date.now(),
        payload: {
          sessionId: session.sessionId,
          event,
        },
      });
    });

    this.sessionUnsubscribers.set(session.sessionId, unsub);
  }

  private async pollSessions(requestId: string): Promise<void> {
    try {
      const sessions = await this.adapter.listSessions();
      this.sendToHq({
        type: 'copilot-sdk-session-list',
        timestamp: Date.now(),
        payload: { requestId, sessions },
      });
    } catch (err) {
      console.warn(`⚠ Session poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Merge HQ tools and system message into a session config */
  private injectHqConfig(config: SessionConfig): SessionConfig {
    return {
      ...config,
      tools: [...(config.tools ?? []), ...this.hqTools],
      systemMessage: config.systemMessage ?? buildSystemMessage(this.projectId, this.projectName),
    };
  }
}
