/**
 * Payload sanitization for safe logging.
 *
 * Strips auth tokens, truncates large payloads, and removes sensitive fields
 * before data is written to logs or attached to OTEL spans.
 */

const SENSITIVE_KEYS = new Set([
  'authorization',
  'token',
  'sessiontoken',
  'sessionToken',
  'secret',
  'password',
  'cookie',
]);

const MAX_PAYLOAD_BYTES = 2048;

/**
 * Recursively strip sensitive fields and truncate large payloads.
 * Returns a new object — never mutates the original.
 */
export function sanitize(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;

  if (typeof payload === 'string') {
    return truncateString(payload, MAX_PAYLOAD_BYTES);
  }

  if (typeof payload !== 'object') return payload;

  // Stringify once to check total size
  let raw: string;
  try {
    raw = JSON.stringify(payload);
  } catch {
    return '[unserializable]';
  }

  if (raw.length > MAX_PAYLOAD_BYTES) {
    return JSON.parse(raw.slice(0, MAX_PAYLOAD_BYTES)) ?? `${raw.slice(0, MAX_PAYLOAD_BYTES)}...(truncated)`;
  }

  return redactObject(payload as Record<string, unknown>);
}

/**
 * Produce a sanitized JSON string suitable for log output.
 */
export function sanitizeToString(payload: unknown): string {
  if (payload === null || payload === undefined) return '';

  let raw: string;
  try {
    raw = JSON.stringify(payload, redactReplacer);
  } catch {
    return '[unserializable]';
  }

  if (raw.length > MAX_PAYLOAD_BYTES) {
    return raw.slice(0, MAX_PAYLOAD_BYTES) + '...(truncated)';
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function redactReplacer(_key: string, value: unknown): unknown {
  if (typeof _key === 'string' && SENSITIVE_KEYS.has(_key.toLowerCase())) {
    return '[REDACTED]';
  }
  if (typeof value === 'string' && value.length > 500) {
    return value.slice(0, 500) + '…';
  }
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? redactObject(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function truncateString(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '...(truncated)';
}
