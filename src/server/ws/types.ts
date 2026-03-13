import type { WebSocket } from "ws";

// --- Channels ---

/** Known channels clients can subscribe to. */
export type Channel = "devcontainer" | "copilot" | "terminal" | "daemon" | "attention";

export const VALID_CHANNELS: ReadonlySet<string> = new Set<Channel>([
  "devcontainer",
  "copilot",
  "terminal",
  "daemon",
  "attention",
]);

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

// --- Connection tracking ---

export interface TrackedClient {
  id: string;
  socket: WebSocket;
  channels: Set<Channel>;
  alive: boolean;
}
