/**
 * Copilot SDK adapter interface.
 *
 * Wraps the real @github/copilot-sdk (or a mock) behind a stable
 * interface so the daemon can operate against either implementation.
 */

import type {
  CopilotSdkSessionInfo,
  CopilotSessionEvent,
  CopilotSdkState,
} from '../../shared/protocol.js';

// Re-export shared types used by consumers of the adapter
export type { CopilotSdkSessionInfo, CopilotSessionEvent, CopilotSdkState };

// ---------------------------------------------------------------------------
// Adapter-specific types (runtime-only, not sent over wire)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface SessionConfig {
  model?: string;
  systemMessage?: { mode: 'append' | 'replace'; content: string };
  tools?: ToolDefinition[];
  streaming?: boolean;
}

// ---------------------------------------------------------------------------
// Session handle returned by create/resume
// ---------------------------------------------------------------------------

export interface CopilotSession {
  readonly sessionId: string;

  /** Send a prompt and return the final assistant message text */
  send(options: {
    prompt: string;
    attachments?: Array<{ type: string; path: string }>;
  }): Promise<string>;

  /** Abort the in-flight request */
  abort(): Promise<void>;

  /** Retrieve the event log for this session */
  getMessages(): Promise<CopilotSessionEvent[]>;

  /** Subscribe to real-time events; returns an unsubscribe function */
  on(handler: (event: CopilotSessionEvent) => void): () => void;

  /** Tear down the session and release resources */
  destroy(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Adapter — the main contract
// ---------------------------------------------------------------------------

export interface CopilotAdapter {
  readonly state: CopilotSdkState;

  /** Connect to the SDK / start the mock */
  start(): Promise<void>;

  /** Disconnect cleanly */
  stop(): Promise<void>;

  /** List all known sessions */
  listSessions(): Promise<CopilotSdkSessionInfo[]>;

  /** Return the most-recently-used session id, or null */
  getLastSessionId(): Promise<string | null>;

  /** Create a new session with the given config */
  createSession(config: SessionConfig): Promise<CopilotSession>;

  /** Reconnect to an existing session */
  resumeSession(
    sessionId: string,
    config?: Partial<SessionConfig>,
  ): Promise<CopilotSession>;

  /** Delete a session from the SDK registry */
  deleteSession(sessionId: string): Promise<void>;

  /** Subscribe to adapter state changes; returns unsubscribe */
  onStateChange(handler: (state: CopilotSdkState) => void): () => void;
}
