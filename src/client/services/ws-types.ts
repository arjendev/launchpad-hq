/**
 * WebSocket message types — mirrors src/server/ws/types.ts for the client.
 * Keep in sync with the server protocol.
 */

// --- Channels ---

export type Channel = "devcontainer" | "copilot" | "terminal";

export const VALID_CHANNELS: readonly Channel[] = [
  "devcontainer",
  "copilot",
  "terminal",
] as const;

// --- Client → Server messages ---

export interface SubscribeMessage {
  type: "subscribe";
  channel: Channel;
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  channel: Channel;
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;

// --- Server → Client messages ---

export interface UpdateMessage {
  type: "update";
  channel: Channel;
  payload: unknown;
}

export interface PongMessage {
  type: "pong";
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage = UpdateMessage | PongMessage | ErrorMessage;

// --- Connection state ---

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";
