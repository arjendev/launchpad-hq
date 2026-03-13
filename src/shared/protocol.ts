/**
 * Daemon ↔ HQ WebSocket protocol types.
 *
 * All messages are discriminated unions keyed on the `type` field.
 * Types only — no runtime WebSocket code lives here.
 */

import type { PROTOCOL_VERSION } from './constants.js';

// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

/** Runtime environment the daemon is managing */
export type RuntimeTarget = 'wsl-devcontainer' | 'wsl' | 'local';

/** Active work state of a project */
export type WorkState = 'working' | 'awaiting' | 'stopped';

/** Full project state snapshot */
export interface ProjectState {
  initialized: boolean;
  daemonOnline: boolean;
  workState: WorkState;
}

/** Static + dynamic info a daemon sends on registration */
export interface DaemonInfo {
  projectId: string;
  projectName: string;
  runtimeTarget: RuntimeTarget;
  capabilities: string[];
  version: string;
  protocolVersion: typeof PROTOCOL_VERSION;
}

/** Copilot session lifecycle state */
export type CopilotSessionState = 'active' | 'idle' | 'ended';

/** Summary of a single Copilot session */
export interface CopilotSessionInfo {
  sessionId: string;
  state: CopilotSessionState;
  model?: string;
  startedAt: number;
  lastActivityAt: number;
}

/** A single message within a Copilot conversation */
export interface CopilotMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/** Attention item surfaced by the daemon */
export interface AttentionItem {
  id: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail?: string;
  source: string;
  timestamp: number;
}

/** Command sub-types that HQ can send to a daemon */
export type CommandAction =
  | 'attach-terminal'
  | 'detach-terminal'
  | 'inject-prompt'
  | 'restart'
  | 'stop';

// ---------------------------------------------------------------------------
// Base message envelope
// ---------------------------------------------------------------------------

interface BaseMessage<T extends string> {
  type: T;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Daemon → HQ messages
// ---------------------------------------------------------------------------

export interface RegisterMessage extends BaseMessage<'register'> {
  payload: DaemonInfo;
}

export interface HeartbeatMessage extends BaseMessage<'heartbeat'> {
  payload: {
    projectId: string;
    uptimeMs: number;
    memoryUsageMb?: number;
  };
}

export interface StatusUpdateMessage extends BaseMessage<'status-update'> {
  payload: {
    projectId: string;
    state: ProjectState;
  };
}

export interface TerminalDataMessage extends BaseMessage<'terminal-data'> {
  payload: {
    projectId: string;
    sessionId: string;
    data: string;
  };
}

export interface CopilotSessionUpdateMessage extends BaseMessage<'copilot-session-update'> {
  payload: {
    projectId: string;
    session: CopilotSessionInfo;
  };
}

export interface CopilotConversationMessage extends BaseMessage<'copilot-conversation'> {
  payload: {
    projectId: string;
    sessionId: string;
    messages: CopilotMessage[];
  };
}

export interface AttentionItemMessage extends BaseMessage<'attention-item'> {
  payload: {
    projectId: string;
    item: AttentionItem;
  };
}

/** Auth response from daemon after receiving a challenge */
export interface AuthResponseMessage extends BaseMessage<'auth-response'> {
  payload: {
    projectId: string;
    token: string;
    nonce: string;
  };
}

export type DaemonToHqMessage =
  | RegisterMessage
  | HeartbeatMessage
  | StatusUpdateMessage
  | TerminalDataMessage
  | CopilotSessionUpdateMessage
  | CopilotConversationMessage
  | AttentionItemMessage
  | AuthResponseMessage;

// ---------------------------------------------------------------------------
// HQ → Daemon messages
// ---------------------------------------------------------------------------

export interface AuthChallengeMessage extends BaseMessage<'auth-challenge'> {
  payload: {
    nonce: string;
  };
}

export interface AuthAcceptMessage extends BaseMessage<'auth-accept'> {
  payload: {
    message: string;
  };
}

export interface AuthRejectMessage extends BaseMessage<'auth-reject'> {
  payload: {
    reason: string;
  };
}

export interface CommandMessage extends BaseMessage<'command'> {
  payload: {
    projectId: string;
    action: CommandAction;
    args?: Record<string, unknown>;
  };
}

export interface TerminalInputMessage extends BaseMessage<'terminal-input'> {
  payload: {
    projectId: string;
    sessionId: string;
    data: string;
  };
}

export interface RequestStatusMessage extends BaseMessage<'request-status'> {
  payload: {
    projectId: string;
  };
}

export type HqToDaemonMessage =
  | AuthChallengeMessage
  | AuthAcceptMessage
  | AuthRejectMessage
  | CommandMessage
  | TerminalInputMessage
  | RequestStatusMessage;

// ---------------------------------------------------------------------------
// Combined union — every message that can travel over the wire
// ---------------------------------------------------------------------------

export type WsMessage = DaemonToHqMessage | HqToDaemonMessage;

/** All valid message type discriminants */
export type MessageType = WsMessage['type'];
