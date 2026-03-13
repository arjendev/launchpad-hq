// ────────────────────────────────────────────────────────
// Copilot session introspection — data models
//
// STATUS: All types are STABLE API surface. When a real
// Copilot SDK ships, only the adapter internals change —
// these interfaces stay the same.
// ────────────────────────────────────────────────────────

/** Role in a conversation turn. */
export type ConversationRole = "user" | "assistant" | "system";

/** A single message in a Copilot conversation. */
export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  timestamp: string; // ISO 8601
}

/** Lifecycle status of a Copilot session. */
export type SessionStatus = "active" | "idle" | "completed" | "error";

/** A Copilot session with its metadata and conversation history. */
export interface CopilotSession {
  id: string;
  status: SessionStatus;
  startedAt: string; // ISO 8601
  repository: string | null; // "owner/repo" or null if not repo-scoped
  currentTask: string | null; // Summary of what the agent is working on
  conversationHistory: ConversationMessage[];
  /** Adapter source: "mock" when simulated, "sdk" when backed by real SDK. */
  adapter: "mock" | "sdk";
}

/** Summary view — omits conversation history for list endpoints. */
export interface CopilotSessionSummary {
  id: string;
  status: SessionStatus;
  startedAt: string;
  repository: string | null;
  currentTask: string | null;
  messageCount: number;
  adapter: "mock" | "sdk";
}

/** Event emitted when a session changes. */
export interface SessionChangeEvent {
  type: "session:created" | "session:updated" | "session:removed";
  session: CopilotSessionSummary;
  timestamp: string;
}

/** Contract for a Copilot session adapter (mock or real SDK). */
export interface CopilotAdapter {
  /** List all known sessions. */
  listSessions(): Promise<CopilotSessionSummary[]>;

  /** Get full session details including conversation history. */
  getSession(id: string): Promise<CopilotSession | null>;

  /** Start polling/watching for session changes. Returns a cleanup function. */
  startWatching(
    onChange: (event: SessionChangeEvent) => void,
  ): () => void;

  /** Stop all activity and release resources. */
  dispose(): void;
}
