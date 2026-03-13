import type { FastifyBaseLogger } from "fastify";
import type { ConnectionManager } from "./connections.js";
import { VALID_CHANNELS, type ClientMessage, type Channel } from "./types.js";

/**
 * Parse and route an incoming WebSocket message for a given client.
 */
export function handleMessage(
  clientId: string,
  raw: string,
  manager: ConnectionManager,
  log: FastifyBaseLogger,
): void {
  let parsed: ClientMessage;

  try {
    parsed = JSON.parse(raw) as ClientMessage;
  } catch {
    manager.send(clientId, { type: "error", message: "Invalid JSON" });
    return;
  }

  if (!parsed || typeof parsed.type !== "string") {
    manager.send(clientId, { type: "error", message: "Missing 'type' field" });
    return;
  }

  switch (parsed.type) {
    case "ping":
      manager.send(clientId, { type: "pong" });
      break;

    case "subscribe": {
      const channel = validateChannel(parsed.channel);
      if (!channel) {
        manager.send(clientId, {
          type: "error",
          message: `Unknown channel: ${String(parsed.channel)}. Valid: ${[...VALID_CHANNELS].join(", ")}`,
        });
        return;
      }
      manager.subscribe(clientId, channel);
      log.debug({ clientId, channel }, "client subscribed");
      break;
    }

    case "unsubscribe": {
      const channel = validateChannel(parsed.channel);
      if (!channel) {
        manager.send(clientId, {
          type: "error",
          message: `Unknown channel: ${String(parsed.channel)}. Valid: ${[...VALID_CHANNELS].join(", ")}`,
        });
        return;
      }
      manager.unsubscribe(clientId, channel);
      log.debug({ clientId, channel }, "client unsubscribed");
      break;
    }

    default:
      manager.send(clientId, { type: "error", message: `Unknown message type: ${(parsed as { type: string }).type}` });
  }
}

function validateChannel(value: unknown): Channel | null {
  if (typeof value === "string" && VALID_CHANNELS.has(value)) {
    return value as Channel;
  }
  return null;
}
