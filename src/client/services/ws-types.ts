/**
 * WebSocket message types — mirrors src/server/ws/types.ts for the client.
 * Keep in sync with the server protocol.
 */

// --- Channels ---

export type Channel = "copilot" | "terminal" | "daemon" | "attention" | "inbox" | "tunnel";

export const VALID_CHANNELS: readonly Channel[] = [
  "copilot",
  "terminal",
  "daemon",
  "attention",
  "inbox",
  "tunnel",
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

// --- Terminal payload types (from server → client via UpdateMessage) ---

export interface TerminalDataPayload {
  type: "terminal:data";
  daemonId: string;
  terminalId: string;
  data: string;
}

export interface TerminalExitPayload {
  type: "terminal:exit";
  daemonId: string;
  terminalId: string;
  exitCode: number;
}

export type TerminalPayload = TerminalDataPayload | TerminalExitPayload;

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
