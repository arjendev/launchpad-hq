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
import { sanitizeForSpan, sanitizeToJsonAttr } from "./sanitize.js";

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

    // Attach request body for mutating methods
    const method = request.method.toUpperCase();
    if ((method === "POST" || method === "PUT" || method === "PATCH") && request.body) {
      const sanitized = sanitizeForSpan(request.body);
      // Strip Authorization headers from the flattened attributes
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(sanitized)) {
        if (!/authorization/i.test(k)) cleaned[k] = v;
      }
      span.addEvent("http.request.body", cleaned);
    }

    // Store span reference for onResponse hook
    (request as unknown as Record<string, unknown>).__otelSpan = span;
  });

  // Capture serialized response payload for span event
  fastify.addHook("onSend", async (request: FastifyRequest, _reply: FastifyReply, payload: unknown) => {
    if (!isTracingEnabled()) return payload;
    if (payload && typeof payload === "string" && payload.length <= 2048) {
      try {
        (request as unknown as Record<string, unknown>).__otelResPayload = JSON.parse(payload);
      } catch {
        // Not JSON — skip
      }
    }
    return payload;
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

    // Attach response body if captured
    const resPayload = (request as unknown as Record<string, unknown>).__otelResPayload;
    if (resPayload) {
      otelSpan.addEvent("http.response.body", { "response.body": sanitizeToJsonAttr(resPayload) });
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
