/**
 * Squad EventBus → HQ WebSocket adapter.
 *
 * Subscribes to squad-sdk EventBus events and forwards them
 * as copilot-session-event messages to HQ.
 */
import { randomUUID } from 'node:crypto';
import type { DaemonToHqMessage } from '../../shared/protocol.js';
import { logSdk } from '../logger.js';

export type SendToHq = (msg: DaemonToHqMessage) => void;

/**
 * squad-sdk EventBus event types we bridge to HQ.
 * Uses colon-delimited names matching the SDK's SquadEventType union.
 */
const SQUAD_EVENT_TYPES = [
  'session:created',
  'session:idle',
  'session:error',
  'session:destroyed',
  'session:message',
  'session:tool_call',
  'agent:milestone',
  'coordinator:routing',
  'pool:health',
] as const;

/**
 * Wire a squad-sdk EventBus instance to forward events to HQ.
 *
 * Each SDK event is wrapped in a `copilot-session-event` message with
 * `sessionType: 'squad-sdk'` so HQ can distinguish it from copilot-sdk events.
 *
 * @returns An unsubscribe function that removes all listeners.
 */
export function bridgeEventBus(
  eventBus: {
    subscribe: (type: string, handler: (event: unknown) => void) => () => void;
    subscribeAll?: (handler: (event: unknown) => void) => () => void;
  },
  sendToHq: SendToHq,
  projectId: string,
  sessionId: string,
): () => void {
  const unsubscribers: Array<() => void> = [];

  for (const eventType of SQUAD_EVENT_TYPES) {
    const unsub = eventBus.subscribe(eventType, (squadEvent: unknown) => {
      logSdk(`Squad event: ${eventType}`);

      const payload =
        typeof squadEvent === 'object' && squadEvent !== null
          ? (squadEvent as Record<string, unknown>).payload ?? squadEvent
          : { value: squadEvent };

      sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId,
          sessionId,
          sessionType: 'squad-sdk',
          event: {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            parentId: null,
            type: `squad.${eventType}`,
            data: payload,
          } as any, // SessionEvent shape — squad events use a superset
        },
      });
    });

    if (typeof unsub === 'function') {
      unsubscribers.push(unsub);
    }
  }

  return () => {
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    }
  };
}
