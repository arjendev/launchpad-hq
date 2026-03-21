/**
 * OpenTelemetry tracing setup for launchpad-hq.
 *
 * Opt-in: only initializes if the LaunchpadConfig has otel.enabled: true.
 * When disabled, all @opentelemetry/api calls are automatic no-ops.
 */

import { trace, context, propagation, type Tracer, type Span, type SpanOptions, SpanStatusCode } from "@opentelemetry/api";

let sdkInitialized = false;

export interface OtelConfig {
  enabled: boolean;
  endpoint: string;
  serviceName?: string;
}

/**
 * Initialize the OpenTelemetry SDK. Must be called EARLY — before Fastify is created.
 * Returns true if OTEL was actually initialized.
 */
export async function setupTracing(config?: OtelConfig): Promise<boolean> {
  if (!config?.enabled || !config.endpoint) {
    return false;
  }

  // Dynamic imports to avoid loading heavy OTEL modules when disabled
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter: GrpcExporter } = await import("@opentelemetry/exporter-trace-otlp-grpc");
  const { OTLPTraceExporter: HttpExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import("@opentelemetry/semantic-conventions");
  const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");

  const serviceName = config.serviceName ?? "launchpad-hq";

  // Use gRPC for port 4317 (Aspire default), HTTP for others
  const isGrpc = config.endpoint.includes(":4317");
  const exporter = isGrpc
    ? new GrpcExporter({ url: config.endpoint })
    : new HttpExporter({ url: config.endpoint });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: "0.1.4",
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Only enable instrumentations we care about
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-fastify": { enabled: true },
        // Disable noisy/unnecessary ones
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ],
  });

  sdk.start();
  sdkInitialized = true;

  // Graceful shutdown
  const shutdownOnce = () => {
    sdk.shutdown().catch(() => { /* best-effort */ });
  };
  process.once("SIGTERM", shutdownOnce);
  process.once("SIGINT", shutdownOnce);

  return true;
}

/** Whether the OTEL SDK was successfully initialized. */
export function isTracingEnabled(): boolean {
  return sdkInitialized;
}

/** Get a named tracer (returns no-op tracer when OTEL is disabled). */
export function getTracer(name = "launchpad-hq"): Tracer {
  return trace.getTracer(name);
}

/**
 * Create a span, run the callback inside it, and close the span when done.
 * Handles both sync and async callbacks. Records exceptions automatically.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => T | Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, options ?? {}, async (span: Span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Extract the current W3C traceparent from the active context.
 * Returns undefined when no active span exists.
 */
export function getTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier["traceparent"];
}

export { trace, context, propagation, SpanStatusCode } from "@opentelemetry/api";
