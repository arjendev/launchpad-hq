// ────────────────────────────────────────────────────────
// CopilotSessionManager — orchestrates adapter + events
//
// Sits between the Fastify plugin layer and whichever
// adapter is active (mock or future real SDK). Owns the
// WebSocket broadcast lifecycle.
// ────────────────────────────────────────────────────────

import type {
  CopilotAdapter,
  CopilotSession,
  CopilotSessionSummary,
  SessionChangeEvent,
} from "./types.js";

export interface SessionManagerOptions {
  adapter: CopilotAdapter;
  /** Called whenever a session change event fires. */
  onSessionChange?: (event: SessionChangeEvent) => void;
}

export class CopilotSessionManager {
  private readonly adapter: CopilotAdapter;
  private readonly onSessionChange?: (event: SessionChangeEvent) => void;
  private stopWatching: (() => void) | null = null;

  constructor(options: SessionManagerOptions) {
    this.adapter = options.adapter;
    this.onSessionChange = options.onSessionChange;
  }

  /** List all sessions (summary view). */
  async listSessions(): Promise<CopilotSessionSummary[]> {
    return this.adapter.listSessions();
  }

  /** Get full session details including conversation history. */
  async getSession(id: string): Promise<CopilotSession | null> {
    return this.adapter.getSession(id);
  }

  /** Begin watching for session changes. Idempotent. */
  startWatching(): void {
    if (this.stopWatching) return; // already watching

    this.stopWatching = this.adapter.startWatching((event) => {
      this.onSessionChange?.(event);
    });
  }

  /** Stop watching and release adapter resources. */
  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.adapter.dispose();
  }
}
