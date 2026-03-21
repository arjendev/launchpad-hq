/**
 * Structured logging for the daemon process.
 *
 * Enhances the original simple logger with:
 *  - Structured JSON fields (component, traceId, data)
 *  - Payload sanitization (strips auth tokens, truncates)
 *  - Decision-branch logging for coordinator/dispatch/agent decisions
 *
 * Keeps the original function signatures (`logIncoming`, `logOutgoing`, `logSdk`)
 * for backward compatibility.
 */

import { sanitizeToString } from './sanitize.js';
import { currentTraceId } from './tracing.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface StructuredLogEntry {
  ts: string;
  level: LogLevel;
  component: string;
  msg: string;
  traceId?: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Core structured emitter
// ---------------------------------------------------------------------------

function emit(level: LogLevel, component: string, msg: string, data?: unknown): void {
  const entry: StructuredLogEntry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...(currentTraceId() ? { traceId: currentTraceId() } : {}),
    ...(data !== undefined ? { data } : {}),
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      console.log(line);
      break;
  }
}

// ---------------------------------------------------------------------------
// Public API — backward-compatible signatures
// ---------------------------------------------------------------------------

/**
 * Log an incoming message from HQ.
 * Payload is sanitized (auth stripped, large values truncated).
 */
export function logIncoming(type: string, payload: unknown): void {
  emit('info', 'ws.incoming', type, sanitizeToString(payload));
}

/**
 * Log an outgoing message to HQ.
 * Payload is sanitized.
 */
export function logOutgoing(type: string, payload: unknown): void {
  emit('info', 'ws.outgoing', type, sanitizeToString(payload));
}

/**
 * Log an SDK lifecycle event or internal daemon message.
 */
export function logSdk(message: string): void {
  emit('info', 'sdk', message);
}

// ---------------------------------------------------------------------------
// Extended structured logging helpers
// ---------------------------------------------------------------------------

/**
 * Log an SDK call being made (method + key arguments).
 */
export function logSdkCall(method: string, args?: Record<string, unknown>): void {
  emit('info', 'sdk.call', method, args ? sanitizeToString(args) : undefined);
}

/**
 * Log an SDK event received from a session.
 */
export function logSdkEvent(sessionId: string, eventType: string, data?: unknown): void {
  emit('info', 'sdk.event', `${eventType} [${sessionId}]`, data ? sanitizeToString(data) : undefined);
}

/**
 * Log a decision branch (coordinator restart vs stop, dispatch accepted vs rejected, etc).
 */
export function logDecision(
  component: string,
  decision: string,
  context?: Record<string, unknown>,
): void {
  emit('info', `decision.${component}`, decision, context ? sanitizeToString(context) : undefined);
}

/**
 * Log a warning.
 */
export function logWarn(component: string, message: string, data?: unknown): void {
  emit('warn', component, message, data ? sanitizeToString(data) : undefined);
}

/**
 * Log an error.
 */
export function logError(component: string, message: string, data?: unknown): void {
  emit('error', component, message, data ? sanitizeToString(data) : undefined);
}
