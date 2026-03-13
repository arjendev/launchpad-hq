import { EventEmitter } from "node:events";
import type {
  SessionEvent,
  SessionMetadata,
  ConnectionState,
} from "@github/copilot-sdk";
import type {
  CopilotMessage,
  CopilotHqToolName,
  AggregatedSession,
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

export type { AggregatedSession };

export interface DaemonSdkState {
  daemonId: string;
  state: ConnectionState;
  error?: string;
  updatedAt: number;
}

export interface AggregatorEvents {
  "sessions-updated": (sessions: AggregatedSession[]) => void;
  "session-event": (
    sessionId: string,
    event: SessionEvent,
  ) => void;
  "sdk-state-changed": (
    daemonId: string,
    state: ConnectionState,
  ) => void;
  "tool-invocation": (
    record: ToolInvocationRecord,
  ) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a timestamp that may be an ISO string, a Date, or a number into epoch ms */
function toEpochMs(ts: unknown): number {
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') return new Date(ts).getTime();
  return Date.now();
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
  private tombstones = new Set<string>();

  // ── Session updates ────────────────────────────────────

  /** Called when a daemon sends copilot-session-list — SDK SessionMetadata[] */
  updateSessions(
    daemonId: string,
    projectId: string,
    sessions: SessionMetadata[],
  ): void {
    const now = Date.now();

    for (const info of sessions) {
      if (this.tombstones.has(info.sessionId)) {
        console.log(`[aggregator] Rejecting tombstoned session ${info.sessionId}`);
        continue;
      }

      const existing = this.sessions.get(info.sessionId);
      const aggregated: AggregatedSession = {
        ...existing,
        sessionId: info.sessionId,
        daemonId,
        projectId,
        status: existing?.status ?? 'idle',
        summary: info.summary,
        startedAt: toEpochMs(info.startTime),
        updatedAt: now,
      };
      this.sessions.set(info.sessionId, aggregated);
    }

    this.emit("sessions-updated", this.getAllSessions());
  }

  // ── Firehose events ────────────────────────────────────

  /** Called when a daemon sends copilot-session-event — SDK SessionEvent as-is */
  handleSessionEvent(
    daemonId: string,
    sessionId: string,
    event: SessionEvent,
  ): void {
    const eventTs = toEpochMs(event.timestamp);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastEvent = { type: event.type, timestamp: eventTs };
      session.updatedAt = Date.now();

      // Update session status based on lifecycle events (SDK event names)
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
        event.type === "assistant.streaming_delta" ||
        event.type === "assistant.message_delta" ||
        event.type === "tool.execution_start"
      ) {
        session.status = "active";
      } else if (event.type === "session.shutdown") {
        this.removeSession(sessionId);
        return; // session gone — skip further emit
      }

      // Capture title and mode from enrichment events
      if (event.type === "session.title_changed" && 'title' in event.data) {
        session.title = event.data.title as string;
      }
      if (event.type === "session.mode_changed" && 'mode' in event.data) {
        session.mode = event.data.mode as string;
      }
      if (event.type === "session.model_change" && 'model' in event.data) {
        session.model = event.data.model as string;
      }
    } else if (event.type === "session.shutdown") {
      // No stub to create for a session that's shutting down
      return;
    } else {
      // Create a stub session for events without a prior session-list
      this.sessions.set(sessionId, {
        sessionId,
        daemonId,
        projectId: daemonId,
        status: "idle",
        startedAt: eventTs,
        lastEvent: { type: event.type, timestamp: eventTs },
        updatedAt: Date.now(),
      });
    }

    this.emit("session-event", sessionId, event);
  }

  // ── SDK state ──────────────────────────────────────────

  /** Called when a daemon sends copilot-sdk-state */
  handleSdkStateChange(
    daemonId: string,
    state: ConnectionState,
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
    this.tombstones.add(sessionId);
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
