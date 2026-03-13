import { EventEmitter } from "node:events";
import type {
  CopilotSessionInfo,
  CopilotSessionEvent,
  CopilotSdkState,
  CopilotMessage,
  CopilotHqToolName,
} from "../../shared/protocol.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolInvocationRecord {
  sessionId: string;
  projectId: string;
  tool: CopilotHqToolName;
  args: Record<string, unknown>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AggregatedSession {
  sessionId: string;
  daemonId: string;
  projectId: string;
  cwd?: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
  summary?: string;
  status: "active" | "idle" | "error";
  model?: string;
  startedAt: number;
  lastEvent?: { type: string; timestamp: number };
  updatedAt: number;
}

export interface DaemonSdkState {
  daemonId: string;
  state: CopilotSdkState;
  error?: string;
  updatedAt: number;
}

export interface AggregatorEvents {
  "sessions-updated": (sessions: AggregatedSession[]) => void;
  "session-event": (
    sessionId: string,
    event: CopilotSessionEvent,
  ) => void;
  "sdk-state-changed": (
    daemonId: string,
    state: CopilotSdkState,
  ) => void;
  "tool-invocation": (
    record: ToolInvocationRecord,
  ) => void;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Aggregates Copilot session data from all connected daemons.
 * Browser clients subscribe to events for real-time updates.
 */
export class CopilotSessionAggregator extends EventEmitter {
  private sessions = new Map<string, AggregatedSession>();
  private sdkStates = new Map<string, DaemonSdkState>();
  private conversationHistory = new Map<string, CopilotMessage[]>();
  private toolInvocations = new Map<string, ToolInvocationRecord[]>();

  // ── Session updates ────────────────────────────────────

  /** Called when a daemon sends copilot-session-list or copilot-session-update */
  updateSessions(
    daemonId: string,
    projectId: string,
    sessions: CopilotSessionInfo[],
  ): void {
    const now = Date.now();

    for (const info of sessions) {
      const existing = this.sessions.get(info.sessionId);
      const aggregated: AggregatedSession = {
        ...existing,
        sessionId: info.sessionId,
        daemonId,
        projectId,
        status: info.state === "ended" ? "idle" : info.state,
        model: info.model,
        startedAt: info.startedAt,
        updatedAt: now,
      };
      this.sessions.set(info.sessionId, aggregated);
    }

    this.emit("sessions-updated", this.getAllSessions());
  }

  // ── Firehose events ────────────────────────────────────

  /** Called when a daemon sends copilot-session-event */
  handleSessionEvent(
    daemonId: string,
    sessionId: string,
    event: CopilotSessionEvent,
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastEvent = { type: event.type, timestamp: event.timestamp };
      session.updatedAt = Date.now();

      // Update session status based on lifecycle events
      // "active" = currently processing a prompt; "idle" = ready for input
      if (
        event.type === "session.idle" ||
        event.type === "session.start" ||
        event.type === "assistant.message"
      ) {
        session.status = "idle";
      } else if (event.type === "session.error") {
        session.status = "error";
      } else if (
        event.type === "user.message" ||
        event.type === "assistant.message.delta" ||
        event.type === "tool.executionStart"
      ) {
        session.status = "active";
      } else if (event.type === "session.ended") {
        this.removeSession(sessionId);
        return; // session gone — skip further emit
      }
    } else if (event.type === "session.ended") {
      // No stub to create for a session that's ending
      return;
    } else {
      // Create a stub session for events without a prior session-list
      // daemonId IS the projectId (owner/repo) — never fall back to "unknown"
      this.sessions.set(sessionId, {
        sessionId,
        daemonId,
        projectId: daemonId,
        status: "idle",        startedAt: event.timestamp,
        lastEvent: { type: event.type, timestamp: event.timestamp },
        updatedAt: Date.now(),
      });
    }

    this.emit("session-event", sessionId, event);
  }

  // ── SDK state ──────────────────────────────────────────

  /** Called when a daemon sends copilot-sdk-state */
  handleSdkStateChange(
    daemonId: string,
    state: CopilotSdkState,
    error?: string,
  ): void {
    this.sdkStates.set(daemonId, {
      daemonId,
      state,
      error,
      updatedAt: Date.now(),
    });
    this.emit("sdk-state-changed", daemonId, state);
  }

  // ── Conversation history ───────────────────────────────

  /** Append messages to a session's conversation history */
  appendMessages(sessionId: string, messages: CopilotMessage[]): void {
    const existing = this.conversationHistory.get(sessionId) ?? [];
    existing.push(...messages);
    this.conversationHistory.set(sessionId, existing);
  }

  /** Get full conversation history for a session */
  getMessages(sessionId: string): CopilotMessage[] {
    return this.conversationHistory.get(sessionId) ?? [];
  }

  // ── Tool invocations ──────────────────────────────────

  /** Handle a tool invocation from a Copilot session */
  handleToolInvocation(
    sessionId: string,
    projectId: string,
    tool: CopilotHqToolName,
    args: Record<string, unknown>,
    timestamp: number,
  ): void {
    const record: ToolInvocationRecord = { sessionId, projectId, tool, args, timestamp };

    const existing = this.toolInvocations.get(sessionId) ?? [];
    existing.push(record);
    this.toolInvocations.set(sessionId, existing);

    // Update session status based on tool type
    const session = this.sessions.get(sessionId);
    if (session) {
      if (tool === 'report_progress') {
        const status = args.status as string | undefined;
        if (status === 'blocked') {
          session.status = 'error';
        } else if (status === 'completed') {
          session.status = 'idle';
        }
        session.updatedAt = Date.now();
      } else if (tool === 'report_blocker') {
        session.status = 'error';
        session.updatedAt = Date.now();
      }
    }

    this.emit("tool-invocation", record);
  }

  /** Get tool invocation history for a session */
  getToolInvocations(sessionId: string): ToolInvocationRecord[] {
    return this.toolInvocations.get(sessionId) ?? [];
  }

  // ── Session removal ─────────────────────────────────────

  /** Remove a single session and all associated data */
  removeSession(sessionId: string): void {
    const existed = this.sessions.delete(sessionId);
    this.conversationHistory.delete(sessionId);
    this.toolInvocations.delete(sessionId);

    if (existed) {
      this.emit("sessions-updated", this.getAllSessions());
    }
  }

  // ── Daemon lifecycle ───────────────────────────────────

  /** Clean up all sessions for a disconnected daemon */
  removeDaemon(daemonId: string): void {
    const removedSessionIds: string[] = [];

    for (const [id, session] of this.sessions) {
      if (session.daemonId === daemonId) {
        removedSessionIds.push(id);
        this.sessions.delete(id);
        this.conversationHistory.delete(id);
        this.toolInvocations.delete(id);
      }
    }

    this.sdkStates.delete(daemonId);

    if (removedSessionIds.length > 0) {
      this.emit("sessions-updated", this.getAllSessions());
    }
  }

  // ── Queries ────────────────────────────────────────────

  /** Get all aggregated sessions */
  getAllSessions(): AggregatedSession[] {
    return Array.from(this.sessions.values());
  }

  /** Get sessions for a specific project */
  getSessionsByProject(projectId: string): AggregatedSession[] {
    return this.getAllSessions().filter((s) => s.projectId === projectId);
  }

  /** Get a specific session */
  getSession(sessionId: string): AggregatedSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Get SDK state for a daemon */
  getSdkState(daemonId: string): DaemonSdkState | undefined {
    return this.sdkStates.get(daemonId);
  }

  /** Find which daemon owns a given session */
  findDaemonForSession(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.daemonId;
  }

  get size(): number {
    return this.sessions.size;
  }
}
