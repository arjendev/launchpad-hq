/**
 * Structured logging for the daemon process.
 *
 * This module re-exports from the observability logger which adds:
 *  - Structured JSON output with timestamp, component, trace ID
 *  - Payload sanitization (strips auth tokens, truncates large payloads)
 *  - Decision-branch logging for coordinator/dispatch/agent decisions
 *
 * Original function signatures preserved for backward compatibility.
 */

export {
  logIncoming,
  logOutgoing,
  logSdk,
  logSdkCall,
  logSdkEvent,
  logDecision,
  logWarn,
  logError,
} from './observability/logger.js';
