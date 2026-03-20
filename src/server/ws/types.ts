import type { WebSocket } from "ws";

// --- Channels ---

/** Known channels clients can subscribe to. */
export type Channel = "copilot" | "terminal" | "daemon" | "attention" | "inbox" | "tunnel" | "preview" | "workflow";

export const VALID_CHANNELS: ReadonlySet<string> = new Set<Channel>([
  "copilot",
  "terminal",
  "daemon",
  "attention",
  "inbox",
  "tunnel",
  "preview",
  "workflow",
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

// --- Terminal-specific client → server messages ---

export interface TerminalJoinMessage {
  type: "terminal:join";
  daemonId: string;
  terminalId: string;
}

export interface TerminalLeaveMessage {
  type: "terminal:leave";
  daemonId: string;
  terminalId: string;
}

export interface TerminalInputMessage {
  type: "terminal:input";
  daemonId: string;
  terminalId: string;
  data: string;
}

export interface TerminalResizeMessage {
  type: "terminal:resize";
  daemonId: string;
  terminalId: string;
  cols: number;
  rows: number;
}

export type ClientMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | PingMessage
  | TerminalJoinMessage
  | TerminalLeaveMessage
  | TerminalInputMessage
  | TerminalResizeMessage;

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
