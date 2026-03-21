/**
 * ElicitationRelay — manages the lifecycle of SDK elicitation requests.
 *
 * Captures `elicitation.requested` events from the SDK, relays structured
 * data to HQ, tracks pending requests, and handles HQ responses.
 * The elicitation waits indefinitely for HQ to respond — it only blocks
 * that specific SDK session, not the daemon.
 */

import type { SessionEvent } from '@github/copilot-sdk';
import type { SendToHq } from '../../shared/protocol.js';
import { logSdk } from '../logger.js';
import { startSpan, SpanStatusCode } from '../observability/tracing.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingElicitation {
  sessionId: string;
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
   * The elicitation waits indefinitely for HQ to respond.
   */
  handleElicitationRequested(sessionId: string, event: SessionEvent): void {
    const data = event.data as Record<string, unknown>;
    const elicitationId = (data.requestId as string) ?? event.id;
    const span = startSpan('elicitation.relay', { 'elicitation.id': elicitationId, 'session.id': sessionId });
    span.addEvent('elicitation.message', { elicitationId, sessionId, message: (data.message as string) ?? '', mode: (data.mode as string) ?? 'default' });
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
    span.addEvent('message.sent_to_hq', { 'message.type': 'workflow:elicitation-requested', elicitationId });

    this.pendingElicitations.set(elicitationId, { sessionId });
    logSdk(`Elicitation ${elicitationId} captured (session ${sessionId})`);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
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

    // Clear from pending map
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

  /** Clear all pending elicitations (used during shutdown) */
  clearAll(): void {
    this.pendingElicitations.clear();
  }
}
