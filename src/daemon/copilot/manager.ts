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
import { approveAll, CopilotClient } from '@github/copilot-sdk';
import type {
  ConnectionState,
  CopilotSession,
  CustomAgentConfig,
  MessageOptions,
  ModelInfo,
  ResumeSessionConfig,
  SessionConfig,
  SessionEvent,
  SessionLifecycleEvent,
  SessionMetadata,
  Tool,
} from '@github/copilot-sdk';
import type {
  CopilotAgentCatalogEntry,
  CopilotSessionMode,
  DaemonToHqMessage,
  HqToDaemonMessage,
  PromptDeliveryMode,
  SessionConfigWire,
} from '../../shared/protocol.js';
import { createHqTools } from './hq-tools.js';
import {
  DEFAULT_COPILOT_AGENT_ID,
  createDefaultCopilotAgentCatalogEntry,
} from './agent-catalog.js';
import { buildSystemMessage } from './system-message.js';
import { logIncoming, logOutgoing, logSdk } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendToHq = (msg: DaemonToHqMessage) => void;

type SessionRpc = CopilotSession['rpc'];
type CopilotPlanState = Awaited<ReturnType<SessionRpc['plan']['read']>>;
type CopilotCurrentAgentState = Awaited<ReturnType<SessionRpc['agent']['getCurrent']>>;
type SharedSdkConfig = Pick<
  SessionConfig,
  'model' | 'streaming' | 'systemMessage' | 'tools' | 'onPermissionRequest' | 'customAgents'
>;

type CopilotSessionLike = Pick<
  CopilotSession,
  'sessionId' | 'send' | 'abort' | 'disconnect' | 'setModel' | 'on'
> & {
  rpc: SessionRpc;
};

interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  forceStop(): Promise<void>;
  createSession(config: SessionConfig): Promise<CopilotSessionLike>;
  resumeSession(sessionId: string, config: ResumeSessionConfig): Promise<CopilotSessionLike>;
  deleteSession(sessionId: string): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
  listSessions(): Promise<SessionMetadata[]>;
  getState(): ConnectionState;
  on?(handler: (event: SessionLifecycleEvent) => void): () => void;
}

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
  client?: CopilotClientLike;
  /** Discovered custom-agent definitions to expose to the SDK */
  customAgents?: CustomAgentConfig[];
  /** Agent catalog advertised to HQ for selection */
  agentCatalog?: CopilotAgentCatalogEntry[];
}

interface CurrentSessionAgentSelection {
  agentId: string | null;
  agentName: string | null;
  agentDisplayName: string | null;
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
  private client: CopilotClientLike;
  private sendToHq: SendToHq;
  private activeSessions = new Map<string, CopilotSessionLike>();
  private sessionLoadPromises = new Map<string, Promise<CopilotSessionLike | null>>();
  private sessionUnsubscribers = new Map<string, () => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private lifecycleUnsub: (() => void) | null = null;
  private projectId: string;
  private projectName?: string;
  private hqTools: Tool[];
  private customAgents: CustomAgentConfig[];
  private agentCatalog = new Map<string, CopilotAgentCatalogEntry>();
  private started = false;

  constructor(options: CopilotManagerOptions) {
    this.sendToHq = (msg: DaemonToHqMessage) => {
      const { type, timestamp, ...rest } = msg;
      logOutgoing(type, 'payload' in rest ? (rest as Record<string, unknown>).payload : rest);
      options.sendToHq(msg);
    };
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.projectId = options.projectId ?? 'unknown';
    this.projectName = options.projectName;

    this.hqTools = createHqTools(this.sendToHq, this.projectId);
    this.customAgents = options.customAgents ?? [];

    for (const agent of options.agentCatalog ?? []) {
      this.agentCatalog.set(agent.id, agent);
    }
    if (!this.agentCatalog.has(DEFAULT_COPILOT_AGENT_ID)) {
      const defaultAgent = createDefaultCopilotAgentCatalogEntry();
      this.agentCatalog.set(defaultAgent.id, defaultAgent);
    }

    this.client =
      options.client ??
      new CopilotClient({
        cwd: options.cwd ?? process.cwd(),
        autoRestart: true,
        autoStart: false,
        logLevel: 'warning',
      });
  }

  /** Start the SDK client and begin polling sessions.
   *  Idempotent — safe to call on reconnect without leaking listeners. */
  async start(): Promise<void> {
    if (this.started) return;

    // Wire client-level lifecycle events (session created/deleted/updated).
    // Guard: skip events for sessions that already have a dedicated
    // session.on() listener (via trackSession) to prevent duplicate forwarding.
    if (typeof this.client.on === 'function') {
      this.lifecycleUnsub = this.client.on(
        (event: SessionLifecycleEvent) => {
          if (event.sessionId && !this.activeSessions.has(event.sessionId)) {
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
    logIncoming(msg.type, msg.payload);

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
          msg.payload.mode,
        );
        break;

      case 'copilot-abort-session':
        await this.handleAbort(msg.payload.sessionId);
        break;

      case 'copilot-list-sessions':
        await this.pollSessions(msg.payload.requestId);
        break;

      case 'copilot-set-model':
        await this.handleSetModel(msg.payload.sessionId, msg.payload.model);
        break;

      case 'copilot-get-mode':
        await this.handleGetMode(msg.payload.requestId, msg.payload.sessionId);
        break;

      case 'copilot-set-mode':
        await this.handleSetMode(msg.payload.sessionId, msg.payload.mode);
        break;

      case 'copilot-get-agent':
        await this.handleGetAgent(msg.payload.requestId, msg.payload.sessionId);
        break;

      case 'copilot-set-agent':
        await this.handleSetAgent(
          msg.payload.requestId,
          msg.payload.sessionId,
          msg.payload.agentId,
        );
        break;

      case 'copilot-get-plan':
        await this.handleGetPlan(msg.payload.requestId, msg.payload.sessionId);
        break;

      case 'copilot-update-plan':
        await this.handleUpdatePlan(msg.payload.sessionId, msg.payload.content);
        break;

      case 'copilot-delete-plan':
        await this.handleDeletePlan(msg.payload.sessionId);
        break;

      case 'copilot-disconnect-session':
        await this.handleDisconnect(msg.payload.sessionId);
        break;

      case 'copilot-list-models':
        await this.handleListModels(msg.payload.requestId);
        break;

      case 'copilot-delete-session':
        await this.handleDeleteSession(msg.payload.sessionId);
        break;

      default:
        // Not a copilot command — ignore
        break;
    }
  }

  /** Expose the current SDK connection state */
  get connectionState(): ConnectionState {
    return this.client.getState();
  }

  // -----------------------------------------------------------------------
  // Command handlers
  // -----------------------------------------------------------------------

  private async handleCreateSession(
    requestId: string,
    config?: SessionConfigWire,
  ): Promise<void> {
    try {
      const selectedAgent = this.resolveRequestedAgent(config?.agentId);
      const sdkConfig: SessionConfig = this.buildSharedSdkConfig(config);
      const session = await this.client.createSession(sdkConfig);
      logSdk(`Session created: ${session.sessionId}`);
      this.trackSession(session, true);
      await this.applyAgentSelection(session, selectedAgent);
      const currentAgent = await this.getCurrentSessionAgent(session);

      // SDK will emit session.start via the event handler, but we also send
      // a synthetic event so HQ can correlate the requestId
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId: session.sessionId,
          event: syntheticEvent('session.start', {
            requestId,
            sessionId: session.sessionId,
            ...this.toAgentEventData(currentAgent),
          }),
        },
      });
    } catch (err) {
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId: 'unknown',
          event: syntheticEvent('session.error', {
            requestId,
            errorType: 'daemon',
            message: String(err),
          }),
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
      const trackedSession = this.activeSessions.get(sessionId);
      const session =
        trackedSession ??
        await this.getOrAttachSession(sessionId, config, {
          skipInitialStart: true,
          throwOnError: true,
          requireKnownSession: false,
        });

      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      if (config?.model) {
        await session.setModel(config.model);
      }

      if (config?.agentId !== undefined) {
        const selectedAgent = this.resolveRequestedAgent(config.agentId);
        await this.applyAgentSelection(session, selectedAgent);
      }
      const currentAgent = await this.getCurrentSessionAgent(session);

      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId: session.sessionId,
          event: syntheticEvent('session.start', {
            requestId,
            resumed: true,
            ...this.toAgentEventData(currentAgent),
          }),
        },
      });
    } catch (err) {
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          event: syntheticEvent('session.error', {
            requestId,
            errorType: 'daemon',
            message: String(err),
          }),
        },
      });
    }
  }

  private async handleSendPrompt(
    sessionId: string,
    prompt: string,
    attachments?: MessageOptions['attachments'],
    mode?: PromptDeliveryMode,
  ): Promise<void> {
    const session = await this.getOrAttachSession(sessionId, undefined, {
      skipInitialStart: true,
    });
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
      await session.send({
        prompt,
        ...(attachments ? { attachments } : {}),
        ...(mode ? { mode } : {}),
      });
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
      logSdk(`Session removed: ${sessionId}`);
    }

    // Always try to delete from SDK registry
    if (this.started) {
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
        event: syntheticEvent('session.shutdown', {
          sessionId,
          reason: 'aborted',
          shutdownType: 'routine',
        }),
      },
    });
  }

  private async handleSetModel(sessionId: string, model: string): Promise<void> {
    const session = await this.getOrAttachSession(sessionId, undefined, {
      skipInitialStart: true,
    });
    if (!session) return;
    try {
      await session.setModel(model);
    } catch (err) {
      this.sendSessionError(sessionId, `setModel failed: ${String(err)}`);
    }
  }

  private async handleGetMode(requestId: string, sessionId: string): Promise<void> {
    const session = await this.getOrAttachSession(sessionId, undefined, {
      skipInitialStart: true,
    });
    if (!session) return;
    try {
      const result = await session.rpc.mode.get();
      this.sendToHq({
        type: 'copilot-mode-response',
        timestamp: Date.now(),
        payload: { requestId, sessionId, mode: result.mode },
      });
    } catch (err) {
      this.sendSessionError(sessionId, `getMode failed: ${String(err)}`);
    }
  }

  private async handleSetMode(sessionId: string, mode: CopilotSessionMode): Promise<void> {
    const session = await this.getOrAttachSession(sessionId, undefined, {
      skipInitialStart: true,
    });
    if (!session) return;
    try {
      await session.rpc.mode.set({ mode });
    } catch (err) {
      this.sendSessionError(sessionId, `setMode failed: ${String(err)}`);
    }
  }

  private async handleGetAgent(requestId: string, sessionId: string): Promise<void> {
    const session = await this.getOrAttachSession(sessionId, undefined, {
      skipInitialStart: true,
    });
    if (!session) {
      this.sendAgentResponse({
        requestId,
        sessionId,
        agentId: null,
        agentName: null,
        error: `No active session: ${sessionId}`,
      });
      return;
    }

    try {
      const currentAgent = await this.getCurrentSessionAgent(session);
      this.sendAgentResponse({
        requestId,
        sessionId,
        ...this.toAgentResponseData(currentAgent),
      });
    } catch (err) {
      this.sendAgentResponse({
        requestId,
        sessionId,
        agentId: null,
        agentName: null,
        error: `getAgent failed: ${String(err)}`,
      });
    }
  }

  private async handleSetAgent(
    requestId: string,
    sessionId: string,
    agentId: string | null,
  ): Promise<void> {
    const session = await this.getOrAttachSession(sessionId, undefined, {
      skipInitialStart: true,
    });
    if (!session) {
      this.sendAgentResponse({
        requestId,
        sessionId,
        agentId: null,
        agentName: null,
        error: `No active session: ${sessionId}`,
      });
      return;
    }

    try {
      const selectedAgent = this.resolveRequestedAgent(agentId);
      await this.applyAgentSelection(session, selectedAgent);
      const currentAgent = await this.getCurrentSessionAgent(session);
      this.sendAgentResponse({
        requestId,
        sessionId,
        ...this.toAgentResponseData(currentAgent),
      });
    } catch (err) {
      this.sendAgentResponse({
        requestId,
        sessionId,
        agentId: null,
        agentName: null,
        error: `setAgent failed: ${String(err)}`,
      });
    }
  }

  private async handleGetPlan(requestId: string, sessionId: string): Promise<void> {
    const session = await this.getOrAttachSession(sessionId, undefined, {
      skipInitialStart: true,
    });
    if (!session) return;
    try {
      const plan: CopilotPlanState = await session.rpc.plan.read();
      this.sendToHq({
        type: 'copilot-plan-response',
        timestamp: Date.now(),
        payload: { requestId, sessionId, plan },
      });
    } catch (err) {
      this.sendSessionError(sessionId, `getPlan failed: ${String(err)}`);
    }
  }

  private async handleUpdatePlan(sessionId: string, content: string): Promise<void> {
    const session = await this.getOrAttachSession(sessionId, undefined, {
      skipInitialStart: true,
    });
    if (!session) return;
    try {
      await session.rpc.plan.update({ content });
    } catch (err) {
      this.sendSessionError(sessionId, `updatePlan failed: ${String(err)}`);
    }
  }

  private async handleDeletePlan(sessionId: string): Promise<void> {
    const session = await this.getOrAttachSession(sessionId, undefined, {
      skipInitialStart: true,
    });
    if (!session) return;
    try {
      await session.rpc.plan.delete();
    } catch (err) {
      this.sendSessionError(sessionId, `deletePlan failed: ${String(err)}`);
    }
  }

  private async handleDisconnect(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    try {
      await session.disconnect();
    } catch {
      // session may already be disconnected
    }

    const unsub = this.sessionUnsubscribers.get(sessionId);
    if (unsub) unsub();
    this.sessionUnsubscribers.delete(sessionId);
    this.activeSessions.delete(sessionId);
    logSdk(`Session removed: ${sessionId}`);

    this.sendToHq({
      type: 'copilot-session-event',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId,
        event: syntheticEvent('session.shutdown', {
          sessionId,
          reason: 'disconnected',
          shutdownType: 'routine',
        }),
      },
    });
  }

  private async handleListModels(requestId: string): Promise<void> {
    if (!this.started) return;
    try {
      const models = await this.client.listModels();
      this.sendToHq({
        type: 'copilot-models-list',
        timestamp: Date.now(),
        payload: { requestId, models },
      });
    } catch (err) {
      console.warn(`⚠ listModels failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleDeleteSession(sessionId: string): Promise<void> {
    // Track deleted session so it's filtered from future polls
    this.deletedSessionIds.add(sessionId);

    // Disconnect locally if tracked
    const session = this.activeSessions.get(sessionId);
    if (session) {
      try { await session.disconnect(); } catch { /* already disconnected */ }
      const unsub = this.sessionUnsubscribers.get(sessionId);
      if (unsub) unsub();
      this.sessionUnsubscribers.delete(sessionId);
      this.activeSessions.delete(sessionId);
      logSdk(`Session removed: ${sessionId}`);
    }

    // Delete from SDK registry (permanent)
    if (this.started) {
      try {
        await this.client.deleteSession(sessionId);
      } catch {
        // session may not exist in registry
      }
    }

    this.sendToHq({
      type: 'copilot-session-event',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId,
        event: syntheticEvent('session.shutdown', {
          sessionId,
          reason: 'deleted',
          shutdownType: 'routine',
        }),
      },
    });
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Send a session error event to HQ */
  private sendSessionError(sessionId: string, message: string): void {
    this.sendToHq({
      type: 'copilot-session-event',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId,
        event: syntheticEvent('session.error', { errorType: 'daemon', message }),
      },
    });
  }

  private async getOrAttachSession(
    sessionId: string,
    config?: Partial<SessionConfigWire>,
    options?: {
      skipInitialStart?: boolean;
      throwOnError?: boolean;
      requireKnownSession?: boolean;
    },
  ): Promise<CopilotSessionLike | null> {
    const trackedSession = this.activeSessions.get(sessionId);
    if (trackedSession) {
      return trackedSession;
    }

    const existingLoad = this.sessionLoadPromises.get(sessionId);
    if (existingLoad) {
      return existingLoad;
    }

    const loadPromise = (async () => {
      const knownSession =
        options?.requireKnownSession === false
          ? true
          : await this.findKnownSession(sessionId);
      if (!knownSession) {
        return null;
      }

      try {
        const session = await this.client.resumeSession(
          sessionId,
          this.buildSharedSdkConfig(config),
        );
        this.trackSession(session, options?.skipInitialStart ?? true);
        return session;
      } catch (err) {
        if (options?.throwOnError) {
          throw err;
        }
        return null;
      }
    })();

    this.sessionLoadPromises.set(sessionId, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.sessionLoadPromises.delete(sessionId);
    }
  }

  private async findKnownSession(sessionId: string): Promise<SessionMetadata | null> {
    if (!this.started) {
      return null;
    }

    try {
      const sessions = await this.client.listSessions();
      return sessions.find((session) => session.sessionId === sessionId) ?? null;
    } catch {
      return null;
    }
  }

  private sendAgentResponse(payload: {
    requestId: string;
    sessionId: string;
    agentId: string | null;
    agentName: string | null;
    error?: string;
  }): void {
    this.sendToHq({
      type: 'copilot-agent-response',
      timestamp: Date.now(),
      payload,
    });
  }

  private shouldSuppressForwardedEvent(event: SessionEvent): boolean {
    // The daemon currently auto-approves all tool permissions via `approveAll`.
    // The SDK still emits a permission.requested event before that approval is
    // applied, but surfacing it in HQ creates a bogus Allow/Deny prompt even
    // though the session is already continuing. Keep later permission outcome
    // events if they occur, but drop the non-actionable request event.
    return event.type.startsWith('permission.request');
  }

  /**
   * Track a session and forward its events to HQ as-is.
   *
   * @param skipInitialStart — When true, the first `session.start` event from
   *   the SDK is suppressed because the caller (create/resume) already sent an
   *   explicit synthetic event carrying the requestId needed for correlation.
   */
  private trackSession(session: CopilotSessionLike, skipInitialStart = false): void {
    // Clean up any previous listener for this sessionId to prevent leaks
    const oldUnsub = this.sessionUnsubscribers.get(session.sessionId);
    if (oldUnsub) oldUnsub();

    this.activeSessions.set(session.sessionId, session);
    logSdk(`Session tracked: ${session.sessionId} (event listener attached)`);

    let skipStart = skipInitialStart;

    const unsub = session.on((event: SessionEvent) => {
      // Skip the initial session.start — create/resume already sent it
      // with the requestId needed for HQ correlation.
      if (skipStart && event.type === 'session.start') {
        skipStart = false;
        return;
      }

      if (this.shouldSuppressForwardedEvent(event)) {
        return;
      }

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

  /** Set of session IDs that failed to resume and were permanently deleted */
  private deletedSessionIds = new Set<string>();

  private async pollSessions(requestId: string): Promise<void> {
    if (!this.started) return;
    try {
      const sessions = await this.client.listSessions();
      // Filter out sessions we've already deleted (SDK may still list them briefly)
      const healthy = sessions.filter(s => !this.deletedSessionIds.has(s.sessionId));
      this.sendToHq({
        type: 'copilot-session-list',
        timestamp: Date.now(),
        payload: { projectId: this.projectId, requestId, sessions: healthy },
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

  private getDefaultAgentEntry(): CopilotAgentCatalogEntry {
    const defaultAgent = this.agentCatalog.get(DEFAULT_COPILOT_AGENT_ID);
    if (!defaultAgent) {
      throw new Error('Default Copilot agent catalog entry is missing');
    }
    return defaultAgent;
  }

  private resolveRequestedAgent(requestedAgentId?: string | null): CopilotAgentCatalogEntry {
    const selectedAgent =
      this.findAgentEntry(requestedAgentId) ??
      (requestedAgentId === undefined || requestedAgentId === null
        ? this.getDefaultAgentEntry()
        : undefined);

    if (!selectedAgent) {
      throw new Error(`Unknown Copilot agent selection: ${requestedAgentId}`);
    }

    return selectedAgent;
  }

  private findAgentEntry(agentIdOrName?: string | null): CopilotAgentCatalogEntry | undefined {
    if (!agentIdOrName) return undefined;
    if (this.agentCatalog.has(agentIdOrName)) {
      return this.agentCatalog.get(agentIdOrName);
    }
    if (agentIdOrName === 'default' || agentIdOrName === 'plain') {
      return this.agentCatalog.get(DEFAULT_COPILOT_AGENT_ID);
    }
    for (const agent of this.agentCatalog.values()) {
      if (agent.name === agentIdOrName) {
        return agent;
      }
    }
    return undefined;
  }

  private async applyAgentSelection(
    session: CopilotSessionLike,
    agent: CopilotAgentCatalogEntry,
  ): Promise<void> {
    const rpcAgent = session?.rpc?.agent;

    if (agent.kind === 'default') {
      if (typeof rpcAgent?.deselect === 'function') {
        await rpcAgent.deselect();
      }
      return;
    }

    if (typeof rpcAgent?.select !== 'function') {
      throw new Error('Installed Copilot SDK does not support session.rpc.agent.select()');
    }

    await rpcAgent.select({ name: agent.name });
  }

  private async getCurrentSessionAgent(
    session: CopilotSessionLike,
  ): Promise<CurrentSessionAgentSelection> {
    const result: CopilotCurrentAgentState = await session.rpc.agent.getCurrent();
    const currentAgent = result.agent;
    if (!currentAgent) {
      return {
        agentId: null,
        agentName: null,
        agentDisplayName: null,
      };
    }

    const catalogEntry = this.findAgentEntry(currentAgent.name);
    return {
      agentId: catalogEntry?.kind === 'default' ? null : (catalogEntry?.id ?? currentAgent.name),
      agentName: catalogEntry?.name ?? currentAgent.name,
      agentDisplayName: catalogEntry?.displayName ?? currentAgent.displayName ?? null,
    };
  }

  private toAgentEventData(agent: CurrentSessionAgentSelection): Record<string, unknown> {
    return {
      agentId: agent.agentId ?? DEFAULT_COPILOT_AGENT_ID,
      ...(agent.agentName ? { agentName: agent.agentName } : {}),
      ...(agent.agentDisplayName ? { agentDisplayName: agent.agentDisplayName } : {}),
    };
  }

  private toAgentResponseData(agent: CurrentSessionAgentSelection): {
    agentId: string | null;
    agentName: string | null;
  } {
    return {
      agentId: agent.agentId,
      agentName: agent.agentDisplayName ?? agent.agentName,
    };
  }

  /** Build a typed SDK config from a wire config + HQ injections */
  private buildSharedSdkConfig(wire?: Partial<SessionConfigWire>): SharedSdkConfig {
    const config = wire ?? {};
    return {
      ...(config.model && { model: config.model }),
      ...(config.streaming !== undefined && { streaming: config.streaming }),
      systemMessage: config.systemMessage ?? buildSystemMessage(this.projectId, this.projectName),
      tools: [...this.hqTools],
      ...(this.customAgents.length > 0 ? { customAgents: this.customAgents } : {}),
      onPermissionRequest: approveAll,
    };
  }
}
