/**
 * Fastify plugin for request-scoped OpenTelemetry tracing.
 *
 * Adds trace context, creates request spans, and logs route metrics.
 * When OTEL is disabled, this plugin still provides a no-op traceId decorator.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { trace, context, propagation, SpanStatusCode } from "@opentelemetry/api";
import { isTracingEnabled, getTracer } from "./tracing.js";

declare module "fastify" {
  interface FastifyRequest {
    traceId: string;
  }
}

async function otelPlugin(fastify: FastifyInstance) {
  // Decorate with traceId (empty string default — overridden per-request)
  fastify.decorateRequest("traceId", "");

  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    if (!isTracingEnabled()) {
      request.traceId = "";
      return;
    }

    // Extract incoming trace context from headers (W3C traceparent)
    const extractedContext = propagation.extract(context.active(), request.headers);
    const tracer = getTracer("launchpad-hq-http");
    const span = tracer.startSpan(
      `${request.method} ${request.routeOptions?.url ?? request.url}`,
      {
        attributes: {
          "http.method": request.method,
          "http.url": request.url,
          "http.route": request.routeOptions?.url ?? request.url,
        },
      },
      extractedContext,
    );

    // Store span in context for downstream use
    const spanContext = trace.setSpan(extractedContext, span);
    context.with(spanContext, () => {});

    // Expose trace ID on request for route handlers
    request.traceId = span.spanContext().traceId;

    // Store span reference for onResponse hook
    (request as unknown as Record<string, unknown>).__otelSpan = span;
  });

  fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const span = (request as unknown as Record<string, unknown>).__otelSpan;
    if (!span || typeof (span as Record<string, unknown>).end !== "function") return;

    const otelSpan = span as import("@opentelemetry/api").Span;
    const statusCode = reply.statusCode;

    otelSpan.setAttribute("http.status_code", statusCode);

    if (statusCode >= 400) {
      otelSpan.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${statusCode}` });
    } else {
      otelSpan.setStatus({ code: SpanStatusCode.OK });
    }

    otelSpan.end();

    // Log request completion at debug level (uses Fastify Pino logger)
    const duration = reply.elapsedTime;
    fastify.log.debug(
      { method: request.method, url: request.url, statusCode, duration: `${duration.toFixed(1)}ms`, traceId: request.traceId || undefined },
      `${request.method} ${request.url} → ${statusCode} (${duration.toFixed(1)}ms)`,
    );
  });
}

export default fp(otelPlugin, {
  name: "otel-tracing",
});
