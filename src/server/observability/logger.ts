/**
 * Structured logger factory for launchpad-hq.
 *
 * Uses Fastify's built-in Pino logger when available, falls back to a
 * lightweight structured logger that includes trace IDs from OTEL context.
 */

import { trace, context } from "@opentelemetry/api";

/** Structured log entry with optional tracing metadata. */
interface LogEntry {
  timestamp: string;
  level: string;
  logger: string;
  traceId?: string;
  spanId?: string;
  msg: string;
  [key: string]: unknown;
}

/** Minimal logger interface matching Pino/Fastify log levels. */
export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
}

function getTraceContext(): { traceId?: string; spanId?: string } {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const ctx = span.spanContext();
  // All-zeros means no valid trace
  if (ctx.traceId === "00000000000000000000000000000000") return {};
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

function formatEntry(level: string, logger: string, msg: string, data?: Record<string, unknown>): LogEntry {
  const traceCtx = getTraceContext();
  return {
    timestamp: new Date().toISOString(),
    level,
    logger,
    ...traceCtx,
    msg,
    ...(data ?? {}),
  };
}

/**
 * Sanitize sensitive fields from log data.
 * Strips Authorization headers, tokens, and API keys.
 */
export function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = /^(authorization|token|apikey|api_key|secret|password|cookie|x-api-key|daemontoken)$/i;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.test(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = sanitize(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Create a structured logger for a named subsystem.
 * Outputs JSON to stdout with trace context when OTEL is active.
 */
export function createLogger(name: string): Logger {
  return {
    info(msg: string, data?: Record<string, unknown>) {
      const entry = formatEntry("info", name, msg, data ? sanitize(data) : undefined);
      process.stdout.write(JSON.stringify(entry) + "\n");
    },
    warn(msg: string, data?: Record<string, unknown>) {
      const entry = formatEntry("warn", name, msg, data ? sanitize(data) : undefined);
      process.stdout.write(JSON.stringify(entry) + "\n");
    },
    error(msg: string, data?: Record<string, unknown>) {
      const entry = formatEntry("error", name, msg, data ? sanitize(data) : undefined);
      process.stderr.write(JSON.stringify(entry) + "\n");
    },
    debug(msg: string, data?: Record<string, unknown>) {
      const entry = formatEntry("debug", name, msg, data ? sanitize(data) : undefined);
      process.stdout.write(JSON.stringify(entry) + "\n");
    },
  };
}
