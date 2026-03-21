/**
 * Payload sanitization for OTEL span events.
 *
 * Strips auth tokens, truncates large payloads, and flattens data to
 * OTEL-compatible `Record<string, string>` attributes.
 */

const SENSITIVE_KEYS = new Set([
  "authorization",
  "token",
  "sessiontoken",
  "secret",
  "password",
  "cookie",
  "apikey",
  "api_key",
  "x-api-key",
  "daemontoken",
]);

const MAX_STRING_LENGTH = 500;
const MAX_PAYLOAD_BYTES = 2048;

/**
 * Sanitize arbitrary data and flatten it into OTEL-compatible span attributes.
 * - Strips sensitive keys (auth tokens, passwords, cookies)
 * - Truncates individual strings longer than 500 chars
 * - Truncates total serialized payload to 2 KB
 * - Returns `Record<string, string>` suitable for `span.addEvent(name, attrs)`
 */
export function sanitizeForSpan(data: unknown): Record<string, string> {
  if (data === null || data === undefined) return {};

  if (typeof data === "string") {
    return { value: truncate(data) };
  }

  if (typeof data !== "object") {
    return { value: String(data) };
  }

  // Serialize with redaction to check total size
  let raw: string;
  try {
    raw = JSON.stringify(data, redactReplacer);
  } catch {
    return { value: "[unserializable]" };
  }

  if (raw.length > MAX_PAYLOAD_BYTES) {
    raw = raw.slice(0, MAX_PAYLOAD_BYTES) + "...(truncated)";
  }

  // Re-parse the redacted+truncated JSON and flatten to string attributes
  let redacted: Record<string, unknown>;
  try {
    redacted = JSON.parse(raw.endsWith("...(truncated)") ? raw.slice(0, raw.lastIndexOf("...(truncated)")) : raw);
  } catch {
    return { payload: raw };
  }

  return flattenToAttributes(redacted);
}

/**
 * Sanitize data and return as a single JSON string attribute.
 * Useful when the payload should be kept as one blob.
 */
export function sanitizeToJsonAttr(data: unknown): string {
  if (data === null || data === undefined) return "";

  let raw: string;
  try {
    raw = JSON.stringify(data, redactReplacer);
  } catch {
    return "[unserializable]";
  }

  if (raw.length > MAX_PAYLOAD_BYTES) {
    return raw.slice(0, MAX_PAYLOAD_BYTES) + "...(truncated)";
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function redactReplacer(_key: string, value: unknown): unknown {
  if (typeof _key === "string" && SENSITIVE_KEYS.has(_key.toLowerCase())) {
    return "[REDACTED]";
  }
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return value.slice(0, MAX_STRING_LENGTH) + "...(truncated)";
  }
  return value;
}

function truncate(str: string): string {
  if (str.length <= MAX_STRING_LENGTH) return str;
  return str.slice(0, MAX_STRING_LENGTH) + "...(truncated)";
}

/**
 * Flatten a (possibly nested) object into dot-separated string attributes.
 * OTEL span event attributes must be string | number | boolean.
 */
function flattenToAttributes(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      result[fullKey] = "";
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[fullKey] = String(value);
    } else if (Array.isArray(value)) {
      result[fullKey] = JSON.stringify(value).slice(0, MAX_STRING_LENGTH);
    } else if (typeof value === "object") {
      Object.assign(result, flattenToAttributes(value as Record<string, unknown>, fullKey));
    }
  }

  return result;
}
