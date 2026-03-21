/**
 * ElicitationRelay — manages the lifecycle of SDK elicitation requests.
 *
 * Captures `elicitation.requested` events from the SDK, relays structured
 * data to HQ, tracks pending requests with timeouts, and handles HQ responses.
 */

import type { SessionEvent } from '@github/copilot-sdk';
import type { SendToHq } from '../../shared/protocol.js';
import { ELICITATION_TIMEOUT_MS } from '../../shared/constants.js';
import { logSdk } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingElicitation {
  sessionId: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface ElicitationRelayOptions {
  sendToHq: SendToHq;
  projectId: string;
}

/** Callback to send an error to HQ for a given session */
export type SendSessionError = (sessionId: string, message: string) => void;

/**
 * Callback to inject a prompt into an active session.
 * Returns true if the session was found and prompt queued.
 */
export type SendToSession = (sessionId: string, prompt: string) => Promise<boolean>;

/**
 * Callback to check if a session is currently active.
 */
export type IsSessionActive = (sessionId: string) => boolean;

// ---------------------------------------------------------------------------
// ElicitationRelay
// ---------------------------------------------------------------------------

export class ElicitationRelay {
  private sendToHq: SendToHq;
  private projectId: string;

  /** Pending elicitation requests awaiting HQ response: elicitationId → { sessionId, timer } */
  private pendingElicitations = new Map<string, PendingElicitation>();

  constructor(options: ElicitationRelayOptions) {
    this.sendToHq = options.sendToHq;
    this.projectId = options.projectId;
  }

  /**
   * Capture an elicitation.requested SDK event and relay structured data to HQ.
   * Starts a timeout timer — if HQ doesn't respond, the elicitation expires.
   */
  handleElicitationRequested(sessionId: string, event: SessionEvent): void {
    const data = event.data as Record<string, unknown>;
    const elicitationId = (data.requestId as string) ?? event.id;
    const message = (data.message as string) ?? '';
    const mode = (data.mode as 'form' | undefined) ?? undefined;
    const requestedSchema = (data.requestedSchema as { type: 'object'; properties: Record<string, unknown>; required?: string[] }) ?? {
      type: 'object' as const,
      properties: {},
    };

    // Send structured elicitation message to HQ
    this.sendToHq({
      type: 'workflow:elicitation-requested',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId,
        elicitationId,
        message,
        ...(mode ? { mode } : {}),
        requestedSchema,
      },
    });

    // Start timeout timer
    const timer = setTimeout(() => {
      this.pendingElicitations.delete(elicitationId);
      this.sendToHq({
        type: 'workflow:elicitation-timeout',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          elicitationId,
        },
      });
      logSdk(`Elicitation ${elicitationId} timed out (session ${sessionId})`);
    }, ELICITATION_TIMEOUT_MS);

    this.pendingElicitations.set(elicitationId, { sessionId, timer });
    logSdk(`Elicitation ${elicitationId} captured (session ${sessionId})`);
  }

  /**
   * Handle an elicitation response from HQ.
   * Sends a synthetic elicitation.completed event so the aggregator clears
   * the waiting state, and forwards the response to the SDK session.
   */
  handleElicitationResponse(
    elicitationId: string,
    sessionId: string,
    response: Record<string, unknown>,
    isSessionActive: IsSessionActive,
    sendToSession: SendToSession,
    sendSessionError: SendSessionError,
  ): void {
    const pending = this.pendingElicitations.get(elicitationId);
    if (!pending) {
      logSdk(`Elicitation response for unknown/expired request: ${elicitationId}`);
      return;
    }

    // Clear timeout
    clearTimeout(pending.timer);
    this.pendingElicitations.delete(elicitationId);

    if (!isSessionActive(sessionId)) {
      logSdk(`Elicitation response for inactive session: ${sessionId}`);
      return;
    }

    // Emit a synthetic elicitation.completed event so the aggregator
    // clears the waiting state
    this.sendToHq({
      type: 'copilot-session-event',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId,
        event: {
          id: elicitationId,
          timestamp: new Date().toISOString(),
          parentId: null,
          type: 'elicitation.completed',
          data: { requestId: elicitationId },
        } as SessionEvent,
      },
    });

    // Send the user's response back to the session as a user message.
    const responseText = Object.entries(response)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n');

    void sendToSession(sessionId, responseText).catch((err) => {
      sendSessionError(sessionId, `Failed to relay elicitation response: ${String(err)}`);
    });

    logSdk(`Elicitation ${elicitationId} resolved (session ${sessionId})`);
  }

  /** Clear all pending elicitation timers (used during shutdown) */
  clearAll(): void {
    for (const [, pending] of this.pendingElicitations) {
      clearTimeout(pending.timer);
    }
    this.pendingElicitations.clear();
  }
}
