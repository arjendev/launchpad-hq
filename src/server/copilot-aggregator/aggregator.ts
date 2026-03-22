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
  CopilotSessionMode,
  SessionType,
  SessionActivity,
  ActiveToolCall,
  ActiveSubagent,
  SessionPhase,
} from "../../shared/protocol.js";
import type { EventPersistence } from "./event-persistence.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internal session with routing fields (daemonId/projectId) — never sent to clients */
export interface InternalAggregatedSession extends AggregatedSession {
  daemonId: string;
  projectId: string;
}

/** Strip internal routing fields before sending to clients */
export function toClientSession(internal: InternalAggregatedSession): AggregatedSession {
  const { daemonId: _d, projectId: _p, ...client } = internal;
  return client;
}

export interface ToolInvocationRecord {
  sessionId: string;
  projectId: string;
  tool: CopilotHqToolName;
  args: Record<string, unknown>;
  timestamp: number;
}

/** A raw event stored for later retrieval (timeline reconstruction) */
export interface StoredEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
  id?: string;
  parentId?: string;
}

export interface PaginatedEvents {
  events: StoredEvent[];
  hasMore: boolean;
  oldestTimestamp: string | null;
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

const COPILOT_SESSION_MODES = new Set<CopilotSessionMode>(["interactive", "plan", "autopilot"]);

function isCopilotSessionMode(value: unknown): value is CopilotSessionMode {
  return typeof value === "string" && COPILOT_SESSION_MODES.has(value as CopilotSessionMode);
}

/** Create a fresh default activity state */
function createDefaultActivity(): SessionActivity {
  return {
    phase: 'idle',
    intent: null,
    activeToolCalls: [],
    activeSubagents: [],
    backgroundTasks: [],
    waitingState: null,
    tokenUsage: null,
    turnCount: 0,
  };
}

/** Derive the high-level phase from activity state */
function derivePhase(activity: SessionActivity): SessionPhase {
  if (activity.waitingState) return 'waiting';
  if (activity.activeSubagents.some(a => a.status === 'running')) return 'subagent';
  if (activity.activeToolCalls.some(t => t.status === 'running')) return 'tool';
  return 'idle';
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Aggregates Copilot session data from all connected daemons.
 * Browser clients subscribe to events for real-time updates.
 */
export class CopilotSessionAggregator extends EventEmitter {
  private sessions = new Map<string, InternalAggregatedSession>();
  private sdkStates = new Map<string, DaemonSdkState>();
  private conversationHistory = new Map<string, CopilotMessage[]>();
  private toolInvocations = new Map<string, ToolInvocationRecord[]>();
  private eventLogs = new Map<string, StoredEvent[]>();
  private tombstones = new Set<string>();
  private pendingRequests = new Map<string, {
    resolve: (data: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  /** Optional disk persistence for event logs */
  private readonly persistence?: EventPersistence;
  /** Tracks which sessions have been hydrated from disk */
  private hydratedSessions = new Set<string>();
  /** Pending cleanup timers (sessionId → timer) */
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Default timeout for request-response operations (ms) */
  static REQUEST_TIMEOUT = 10_000;

  /** Maximum number of stored events per session */
  static MAX_EVENTS_PER_SESSION = 10_000;

  /** Delay before cleaning up event files for ended sessions (ms) */
  static CLEANUP_DELAY_MS = 30_000;

  constructor(persistence?: EventPersistence) {
    super();
    this.persistence = persistence;
  }

  /** Append a stored event to the session's event log, capping at MAX_EVENTS_PER_SESSION */
  private storeEvent(sessionId: string, event: StoredEvent): void {
    let log = this.eventLogs.get(sessionId);
    if (!log) {
      log = [];
      this.eventLogs.set(sessionId, log);
    }
    log.push(event);
    if (log.length > CopilotSessionAggregator.MAX_EVENTS_PER_SESSION) {
      const excess = log.length - CopilotSessionAggregator.MAX_EVENTS_PER_SESSION;
      log.splice(0, excess);
    }
    // Persist to disk (fire-and-forget)
    this.persistence?.appendEvent(sessionId, event);
  }

  // ── Session updates ────────────────────────────────────

  /** Called when a daemon sends copilot-session-list — only update metadata for already-tracked sessions */
  updateSessions(
    daemonId: string,
    _projectId: string,
    sessions: SessionMetadata[],
  ): void {
    let changed = false;

    for (const info of sessions) {
      // Only update sessions already tracked by the aggregator (created or resumed by user action)
      const existing = this.sessions.get(info.sessionId);
      if (!existing) continue;

      // Update metadata from SDK (summary, timestamps)
      if (info.summary && info.summary !== existing.summary) {
        existing.summary = info.summary;
        changed = true;
      }
      existing.daemonId = daemonId;
      existing.updatedAt = Date.now();
    }

    if (changed) {
      this.emit("sessions-updated", this.getAllSessions());
    }
  }

  /** Explicitly register a new session (from user create/resume action) */
  trackNewSession(
    daemonId: string,
    projectId: string,
    sessionId: string,
    opts?: { sessionType?: SessionType; summary?: string; startedAt?: number },
  ): void {
    if (this.tombstones.has(sessionId)) return;
    if (this.sessions.has(sessionId)) return; // already tracked

    this.sessions.set(sessionId, {
      sessionId,
      sessionType: opts?.sessionType ?? 'copilot-sdk',
      daemonId,
      projectId,
      status: 'idle',
      startedAt: opts?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
      summary: opts?.summary,
      activity: createDefaultActivity(),
    });
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
    let session = this.sessions.get(sessionId);

    if (event.type === "session.shutdown") {
      // Store shutdown event before cleaning up
      const shutdownTs = typeof event.timestamp === 'string' ? event.timestamp
        : Number.isFinite(eventTs) ? new Date(eventTs).toISOString()
        : new Date().toISOString();
      this.storeEvent(sessionId, {
        type: event.type,
        data: (event.data ?? {}) as Record<string, unknown>,
        timestamp: shutdownTs,
        ...(event.id ? { id: event.id } : {}),
        ...((event as SessionEvent & { parentId?: string | null }).parentId ? { parentId: (event as SessionEvent & { parentId?: string | null }).parentId! } : {}),
      });
      if (session) {
        // Mark as ended (keep visible briefly for UI) rather than removing
        session.status = "ended";
        session.activity = createDefaultActivity();
        session.lastEvent = { type: event.type, timestamp: eventTs };
        session.updatedAt = Date.now();
        this.emit("sessions-updated", this.getAllSessions());
      }
      return;
    }

    // Create stub session if needed
    if (!session) {
      const eventSessionType = (event.data as Record<string, unknown>)?.sessionType as SessionType | undefined;
      session = {
        sessionId,
        sessionType: eventSessionType ?? 'copilot-sdk',
        daemonId,
        projectId: daemonId,
        status: "idle",
        startedAt: eventTs,
        lastEvent: { type: event.type, timestamp: eventTs },
        updatedAt: Date.now(),
        activity: createDefaultActivity(),
      };
      this.sessions.set(sessionId, session);
    }

    session.lastEvent = { type: event.type, timestamp: eventTs };
    session.updatedAt = Date.now();

    // Backfill sessionType from event data if not already set
    const eventData = event.data as Record<string, unknown>;
    if (!session.sessionType && eventData?.sessionType) {
      session.sessionType = eventData.sessionType as SessionType;
    }

    // Initialize activity if missing (e.g. old sessions)
    if (!session.activity) {
      session.activity = createDefaultActivity();
    }

    // Update session status based on lifecycle events
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
    }

    // Capture title and mode from enrichment events
    if (event.type === "session.title_changed" && 'title' in event.data) {
      session.title = event.data.title as string;
    }
    if (event.type === "session.mode_changed" && 'mode' in event.data && isCopilotSessionMode(event.data.mode)) {
      session.mode = event.data.mode;
    }
    if (event.type === "session.model_change") {
      // SDK sends the new model as `newModel`; also accept `model` for compatibility
      const d = event.data as Record<string, unknown>;
      const m = (d.newModel ?? d.model) as string | undefined;
      if (m) session.model = m;
    }
    // Also capture the initial model from session.tools_updated (fires before any model_change)
    {
      const e = event as { type: string; data?: Record<string, unknown> };
      if (e.type === "session.tools_updated" && e.data && typeof e.data.model === "string" && !session.model) {
        session.model = e.data.model;
      }
    }

    // Enrich activity state
    this.updateActivity(session, event, eventTs);

    // Store the raw event for later retrieval
    const storedTimestamp = typeof event.timestamp === 'string' ? event.timestamp
      : Number.isFinite(eventTs) ? new Date(eventTs).toISOString()
      : new Date().toISOString();
    this.storeEvent(sessionId, {
      type: event.type,
      data: (event.data ?? {}) as Record<string, unknown>,
      timestamp: storedTimestamp,
      ...(event.id ? { id: event.id } : {}),
      ...((event as SessionEvent & { parentId?: string | null }).parentId ? { parentId: (event as SessionEvent & { parentId?: string | null }).parentId! } : {}),
    });

    this.emit("session-event", sessionId, event);
  }

  /** Update session activity state from an SDK event */
  private updateActivity(
    session: InternalAggregatedSession,
    event: SessionEvent,
    eventTs: number,
  ): void {
    const activity = session.activity;
    const data = event.data as Record<string, unknown>;

    switch (event.type) {
      // ── Turn tracking ──
      case "assistant.turn_start":
        activity.turnCount++;
        activity.phase = 'thinking';
        // Clear tool calls from previous turn
        activity.activeToolCalls = [];
        break;

      case "assistant.turn_end":
        activity.phase = derivePhase(activity);
        break;

      // ── Intent ──
      case "assistant.intent":
        activity.intent = (data?.intent as string) ?? (data?.message as string) ?? null;
        break;

      // ── Tool calls ──
      case "tool.execution_start": {
        const toolId = (data?.toolCallId as string) ?? `tool-${eventTs}`;
        const toolName = (data?.toolName as string) ?? (data?.name as string) ?? 'unknown';
        // Check if this is a subagent's tool call
        const agentId = data?.agentId as string | undefined;
        if (agentId) {
          const sub = activity.activeSubagents.find(a => a.id === agentId);
          if (sub) {
            sub.activeToolCalls.push({ id: toolId, name: toolName, status: 'running', startedAt: eventTs });
            sub.recentEvents = sub.recentEvents.slice(-9).concat({ type: event.type, summary: `Running ${toolName}`, timestamp: eventTs });
          }
        } else {
          activity.activeToolCalls.push({ id: toolId, name: toolName, status: 'running', startedAt: eventTs });
        }
        activity.phase = agentId ? 'subagent' : 'tool';
        break;
      }

      case "tool.execution_complete": {
        const toolId = (data?.toolCallId as string) ?? '';
        const success = data?.success !== false;  // SDK uses `success: boolean`
        const agentId = data?.agentId as string | undefined;
        const updateTool = (calls: ActiveToolCall[]) => {
          const idx = calls.findIndex(t => t.id === toolId);
          if (idx >= 0) {
            calls[idx].status = success ? 'completed' : 'failed';
          }
        };
        if (agentId) {
          const sub = activity.activeSubagents.find(a => a.id === agentId);
          if (sub) {
            updateTool(sub.activeToolCalls);
            sub.activeToolCalls = sub.activeToolCalls.filter(t => t.status === 'running');
          }
        } else {
          updateTool(activity.activeToolCalls);
          activity.activeToolCalls = activity.activeToolCalls.filter(t => t.status === 'running');
        }
        activity.phase = derivePhase(activity);
        break;
      }

      case "tool.execution_progress": {
        const toolId = (data?.toolCallId as string) ?? '';
        const progress = (data?.progressMessage as string) ?? (data?.progress as string) ?? '';
        const agentId = data?.agentId as string | undefined;
        const tools = agentId
          ? activity.activeSubagents.find(a => a.id === agentId)?.activeToolCalls ?? []
          : activity.activeToolCalls;
        const tool = tools.find(t => t.id === toolId);
        if (tool) tool.progress = progress;
        break;
      }

      // ── Subagents ──
      case "subagent.started": {
        // SDK shape: { toolCallId, agentName, agentDisplayName, agentDescription }
        const subId = (data?.toolCallId as string) ?? (data?.agentId as string) ?? `sub-${eventTs}`;
        const subName = (data?.agentName as string) ?? (data?.name as string) ?? 'subagent';
        const subDisplay = (data?.agentDisplayName as string) ?? (data?.displayName as string) ?? subName;
        activity.activeSubagents.push({
          id: subId,
          name: subName,
          displayName: subDisplay,
          status: 'running',
          startedAt: eventTs,
          activeToolCalls: [],
          recentEvents: [{ type: event.type, summary: `Started`, timestamp: eventTs }],
        });
        activity.phase = 'subagent';
        break;
      }

      case "subagent.completed":
      case "subagent.failed": {
        // SDK shape: { toolCallId, agentName, agentDisplayName }
        const subId = (data?.toolCallId as string) ?? (data?.agentId as string) ?? '';
        const sub = activity.activeSubagents.find(a => a.id === subId);
        if (sub) {
          sub.status = event.type === "subagent.completed" ? 'completed' : 'failed';
          sub.activeToolCalls = [];
        }
        // Remove completed/failed subagents from active list
        activity.activeSubagents = activity.activeSubagents.filter(a => a.status === 'running');
        activity.phase = derivePhase(activity);
        break;
      }

      // ── Background tasks ──
      case "session.idle": {
        // Clear active state on idle
        activity.activeToolCalls = [];
        activity.waitingState = null;
        activity.intent = null;
        // SDK shape: { backgroundTasks?: { agents: [...], shells: [...] } }
        const bgData = data?.backgroundTasks as { agents?: Array<{ agentId: string; agentType?: string; description?: string }>; shells?: Array<{ shellId: string; description?: string }> } | undefined;
        const tasks: typeof activity.backgroundTasks = [];
        if (bgData) {
          if (Array.isArray(bgData.agents)) {
            for (const a of bgData.agents) {
              tasks.push({ id: a.agentId, description: a.description ?? a.agentType ?? 'Background agent', status: 'running' });
            }
          }
          if (Array.isArray(bgData.shells)) {
            for (const s of bgData.shells) {
              tasks.push({ id: s.shellId, description: s.description ?? 'Background shell', status: 'running' });
            }
          }
        }
        activity.backgroundTasks = tasks;
        activity.phase = tasks.length > 0 ? 'subagent' : 'idle';
        break;
      }

      // ── Waiting states ──
      case "user_input.requested":
        activity.waitingState = {
          type: 'user-input',
          requestId: (data?.requestId as string) ?? '',
          question: (data?.question as string) ?? (data?.message as string),
          choices: data?.choices as string[] | undefined,
        };
        activity.phase = 'waiting';
        break;

      case "elicitation.requested":
        activity.waitingState = {
          type: 'elicitation',
          requestId: (data?.requestId as string) ?? '',
          question: (data?.question as string) ?? (data?.message as string),
          choices: data?.choices as string[] | undefined,
        };
        activity.phase = 'waiting';
        break;

      case "exit_plan_mode.requested":
        activity.waitingState = {
          type: 'plan-exit',
          requestId: (data?.requestId as string) ?? '',
          question: 'The agent wants to exit plan mode and begin executing. Approve?',
        };
        activity.phase = 'waiting';
        break;

      case "permission.requested":
        activity.waitingState = {
          type: 'permission',
          requestId: (data?.requestId as string) ?? '',
          toolName: data?.toolName as string | undefined,
          toolArgs: data?.toolArgs as Record<string, unknown> | undefined,
        };
        activity.phase = 'waiting';
        break;

      // Clear waiting on resolved events
      case "user_input.completed":
      case "elicitation.completed":
      case "exit_plan_mode.completed":
      case "permission.completed":
        activity.waitingState = null;
        activity.phase = derivePhase(activity);
        break;

      // ── Usage ──
      case "session.usage_info": {
        // SDK shape: { tokenLimit, currentTokens, messagesLength }
        const used = (data?.currentTokens as number) ?? (data?.totalTokens as number);
        const limit = (data?.tokenLimit as number) ?? undefined;
        if (typeof used === 'number') {
          activity.tokenUsage = { used, limit: limit ?? activity.tokenUsage?.limit };
        }
        break;
      }

      case "assistant.usage": {
        // SDK shape: { model, inputTokens, outputTokens, cacheReadTokens, ... }
        const input = (data?.inputTokens as number) ?? 0;
        const output = (data?.outputTokens as number) ?? 0;
        const total = input + output;
        if (total > 0) {
          activity.tokenUsage = {
            used: total,
            limit: activity.tokenUsage?.limit,
          };
        }
        break;
      }

      // ── Subagent intent (if the SDK sends it with an agentId context) ──
      case "assistant.message_delta":
      case "assistant.streaming_delta": {
        const agentId = data?.agentId as string | undefined;
        if (agentId) {
          const sub = activity.activeSubagents.find(a => a.id === agentId);
          if (sub) {
            sub.recentEvents = sub.recentEvents.slice(-9).concat({
              type: event.type,
              summary: 'Responding…',
              timestamp: eventTs,
            });
          }
        }
        // phase stays active (already set by status handler)
        break;
      }

      case "session.error":
        activity.phase = 'error';
        break;

      default:
        // No activity update needed
        break;
    }
  }

  /** Update the session type for a session */
  setSessionType(sessionId: string, sessionType: SessionType): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sessionType = sessionType;
      session.updatedAt = Date.now();
    }
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

    // Store as a synthetic event in the event log
    this.storeEvent(sessionId, {
      type: "copilot:tool-invocation",
      data: { tool, args, projectId },
      timestamp: new Date(timestamp).toISOString(),
    });

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

  // ── Event log ─────────────────────────────────────────

  /**
   * Hydrate the in-memory event log from disk if not already loaded.
   * Must be called before reading the event log for a session after HQ restart.
   */
  private async hydrateFromDisk(sessionId: string): Promise<void> {
    if (!this.persistence || this.hydratedSessions.has(sessionId)) return;
    this.hydratedSessions.add(sessionId);

    const diskEvents = await this.persistence.loadEvents(sessionId);
    if (diskEvents.length === 0) return;

    const memLog = this.eventLogs.get(sessionId) ?? [];
    if (memLog.length === 0) {
      // Fast path: memory empty, just use disk
      this.eventLogs.set(sessionId, diskEvents);
    } else {
      // Memory has post-restart events that are also on disk (since we always
      // flush before loadEvents). Disk is the superset — use it directly.
      this.eventLogs.set(sessionId, diskEvents);
    }
  }

  /** Paginated retrieval of stored events for a session.
   *  Returns events in chronological order; `before` cursor paginates backwards. */
  async getEvents(sessionId: string, before?: string, limit = 100): Promise<PaginatedEvents> {
    await this.hydrateFromDisk(sessionId);

    const log = this.eventLogs.get(sessionId) ?? [];
    const cap = Math.max(1, Math.min(limit, 500));

    let endIndex = log.length; // exclusive upper bound
    if (before) {
      // Find the rightmost event strictly older than `before`
      const beforeMs = new Date(before).getTime();
      endIndex = 0;
      for (let i = log.length - 1; i >= 0; i--) {
        if (new Date(log[i].timestamp).getTime() < beforeMs) {
          endIndex = i + 1;
          break;
        }
      }
    }

    const startIndex = Math.max(0, endIndex - cap);
    const events = log.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;
    const oldestTimestamp = events.length > 0 ? events[0].timestamp : null;

    return { events, hasMore, oldestTimestamp };
  }

  // ── Session removal ─────────────────────────────────────

  /** Remove a single session and all associated data */
  removeSession(sessionId: string): void {
    this.tombstones.add(sessionId);
    const existed = this.sessions.delete(sessionId);
    this.conversationHistory.delete(sessionId);
    this.toolInvocations.delete(sessionId);
    this.eventLogs.delete(sessionId);
    this.hydratedSessions.delete(sessionId);
    this.scheduleEventCleanup(sessionId);

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
        this.eventLogs.delete(id);
        this.hydratedSessions.delete(id);
        this.scheduleEventCleanup(id);
      }
    }

    this.sdkStates.delete(daemonId);

    if (removedSessionIds.length > 0) {
      this.emit("sessions-updated", this.getAllSessions());
    }
  }

  // ── Event persistence lifecycle ────────────────────────

  /** Schedule cleanup of the JSONL file for a session (with delay for client to load final events) */
  scheduleEventCleanup(sessionId: string): void {
    if (!this.persistence) return;
    // Cancel any existing timer
    const existing = this.cleanupTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.cleanupTimers.delete(sessionId);
      void this.persistence!.cleanup(sessionId);
    }, CopilotSessionAggregator.CLEANUP_DELAY_MS);

    this.cleanupTimers.set(sessionId, timer);
  }

  /** Immediately clean up the JSONL file for a session */
  async cleanupSessionEvents(sessionId: string): Promise<void> {
    // Cancel any pending scheduled cleanup
    const existing = this.cleanupTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.cleanupTimers.delete(sessionId);
    }
    this.hydratedSessions.delete(sessionId);
    await this.persistence?.cleanup(sessionId);
  }

  /** Flush all pending event writes to disk (call on shutdown) */
  async flushEvents(): Promise<void> {
    await this.persistence?.flushAll();
  }

  // ── Queries ────────────────────────────────────────────

  /** Get all sessions for client consumption (stripped of internal fields) */
  getAllSessions(): AggregatedSession[] {
    return Array.from(this.sessions.values()).map(toClientSession);
  }

  /** Get sessions for a specific project (client-facing) */
  getSessionsByProject(projectId: string): AggregatedSession[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.projectId === projectId)
      .map(toClientSession);
  }

  /** Get a specific session for client consumption (stripped) */
  getSession(sessionId: string): AggregatedSession | undefined {
    const internal = this.sessions.get(sessionId);
    return internal ? toClientSession(internal) : undefined;
  }

  /** Get internal session with routing fields — for server-side routing only */
  getInternalSession(sessionId: string): InternalAggregatedSession | undefined {
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

  // ── Request-response helpers ──────────────────────────

  /** Register a pending request and return a promise that resolves when the daemon responds */
  waitForResponse<T = unknown>(requestId: string, timeoutMs?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out`));
      }, timeoutMs ?? CopilotSessionAggregator.REQUEST_TIMEOUT);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (data: unknown) => void,
        timer,
      });
    });
  }

  /** Resolve a pending request with data from the daemon */
  resolveRequest(requestId: string, data: unknown): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.resolve(data);
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
