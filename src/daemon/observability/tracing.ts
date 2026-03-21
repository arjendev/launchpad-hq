/**
 * OpenTelemetry tracing setup for the daemon.
 *
 * OTEL is opt-in: tracing is only initialised when `otel.enabled` is true
 * in the daemon config. When disabled, all span helpers return no-op spans
 * from the OTEL API (zero overhead).
 *
 * Must be called EARLY in daemon startup — before any other imports that
 * issue HTTP requests (the auto-instrumentations need to monkey-patch first).
 */

import { trace, context, propagation, type Span, SpanStatusCode, type Context } from '@opentelemetry/api';

// Re-export commonly used OTEL API types for convenience
export { SpanStatusCode } from '@opentelemetry/api';
export type { Span } from '@opentelemetry/api';

// The tracer name used throughout the daemon
const TRACER_NAME = 'launchpad-daemon';

let sdkInstance: { shutdown(): Promise<void> } | null = null;

/**
 * Initialise the OpenTelemetry NodeSDK.
 *
 * Only call this when `config.otel?.enabled` is true.
 * Safe to call multiple times — second call is a no-op.
 */
export async function setupTracing(opts: {
  endpoint: string;
  serviceVersion?: string;
}): Promise<void> {
  if (sdkInstance) return;

  // Dynamic imports keep OTEL deps out of the bundle when tracing is off
  const { NodeTracerProvider, BatchSpanProcessor } = await import(
    /* @vite-ignore */ '@opentelemetry/sdk-trace-node'
  );
  const { OTLPTraceExporter } = await import(
    /* @vite-ignore */ '@opentelemetry/exporter-trace-otlp-http'
  );
  const { resourceFromAttributes } = await import(
    /* @vite-ignore */ '@opentelemetry/resources'
  );
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
    /* @vite-ignore */ '@opentelemetry/semantic-conventions'
  );

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'launchpad-daemon',
    [ATTR_SERVICE_VERSION]: opts.serviceVersion ?? '0.1.0',
  });

  const traceExporter = new OTLPTraceExporter({
    url: opts.endpoint.replace(/\/$/, '') + '/v1/traces',
  });

  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });
  provider.register();

  sdkInstance = { shutdown: () => provider.shutdown() };
}

/**
 * Gracefully shut down the OTEL SDK, flushing pending spans.
 */
export async function shutdownTracing(): Promise<void> {
  if (sdkInstance) {
    await sdkInstance.shutdown();
    sdkInstance = null;
  }
}

/** Whether OTEL tracing was initialised */
export function isTracingEnabled(): boolean {
  return sdkInstance !== null;
}

/**
 * Get the daemon tracer instance.
 * When OTEL is not initialised, this returns the no-op tracer from the API.
 */
export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Extract W3C trace context from an incoming message payload.
 *
 * HQ injects a `traceparent` field into protocol messages.
 * This extracts it into an OTEL Context that can be used as the parent
 * for daemon-side spans, creating a distributed trace: HQ → Daemon → SDK.
 */
export function extractTraceContext(message: { traceparent?: string }): Context {
  if (!message.traceparent) {
    return context.active();
  }

  const carrier: Record<string, string> = {
    traceparent: message.traceparent,
  };

  return propagation.extract(context.active(), carrier);
}

/**
 * Start a span as a child of the given context (or active context).
 * Returns the span — caller is responsible for ending it.
 */
export function startSpan(
  name: string,
  attributes?: Record<string, string | number | boolean>,
  parentContext?: Context,
): Span {
  const tracer = getTracer();
  const ctx = parentContext ?? context.active();
  const span = tracer.startSpan(name, { attributes }, ctx);
  return span;
}

/**
 * Run a sync/async function inside a new span.
 * The span is automatically ended and errors are recorded.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => T | Promise<T>,
  parentContext?: Context,
): Promise<T> {
  const span = startSpan(name, attributes, parentContext);
  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Get the current trace ID from the active context (if any).
 * Returns undefined when tracing is disabled or no active span exists.
 */
export function currentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  const traceId = span.spanContext().traceId;
  // The all-zeros trace ID means no valid trace
  if (traceId === '00000000000000000000000000000000') return undefined;
  return traceId;
}
