/**
 * Barrel export for daemon observability modules.
 */

export {
  setupTracing,
  shutdownTracing,
  isTracingEnabled,
  getTracer,
  extractTraceContext,
  startSpan,
  withSpan,
  currentTraceId,
  SpanStatusCode,
  type Span,
} from './tracing.js';

export {
  logIncoming,
  logOutgoing,
  logSdk,
  logSdkCall,
  logSdkEvent,
  logDecision,
  logWarn,
  logError,
} from './logger.js';

export {
  sanitize,
  sanitizeToString,
} from './sanitize.js';
