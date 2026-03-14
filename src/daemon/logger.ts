/**
 * Structured logging for the daemon process.
 *
 * Prefixes:
 *  [DAEMON ←]   — incoming message from HQ
 *  [DAEMON →]   — outgoing message to HQ
 *  [DAEMON SDK] — SDK session lifecycle events
 */

const PREFIX_IN = '[DAEMON ←]';
const PREFIX_OUT = '[DAEMON →]';
const PREFIX_SDK = '[DAEMON SDK]';

export function logIncoming(type: string, payload: unknown): void {
  console.log(PREFIX_IN, type, summarize(payload));
}

export function logOutgoing(type: string, payload: unknown): void {
  console.log(PREFIX_OUT, type, summarize(payload));
}

export function logSdk(message: string): void {
  console.log(PREFIX_SDK, message);
}

function summarize(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_key, val) => {
      if (typeof val === 'string' && val.length > 100) return val.slice(0, 100) + '…';
      return val;
    });
  } catch {
    return String(obj);
  }
}
