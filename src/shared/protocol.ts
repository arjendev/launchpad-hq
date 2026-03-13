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

// ---------------------------------------------------------------------------
// Copilot SDK integration types
// ---------------------------------------------------------------------------

/** Copilot SDK adapter connection state */
export type CopilotSdkState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Session metadata from the Copilot SDK layer */
export interface CopilotSdkSessionInfo {
  sessionId: string;
  cwd?: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
  summary?: string;
}

/** Event types emitted by the Copilot SDK session */
export type CopilotSessionEventType =
  | 'user.message'
  | 'assistant.message'
  | 'assistant.message.delta'
  | 'assistant.reasoning'
  | 'assistant.reasoning.delta'
  | 'tool.executionStart'
  | 'tool.executionComplete'
  | 'session.start'
  | 'session.idle'
  | 'session.error';

/** A single event from a Copilot SDK session */
export interface CopilotSessionEvent {
  type: CopilotSessionEventType;
  data: Record<string, unknown>;
  timestamp: number;
}

/** Tool definition (wire-safe — no handler) for session configuration */
export interface ToolDefinitionWire {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Session configuration sent over the wire */
export interface SessionConfigWire {
  model?: string;
  systemMessage?: { mode: 'append' | 'replace'; content: string };
  tools?: ToolDefinitionWire[];
  streaming?: boolean;
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

export interface TerminalExitMessage extends BaseMessage<'terminal-exit'> {
  payload: {
    projectId: string;
    terminalId: string;
    exitCode: number;
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

// Daemon → HQ: batch SDK session list (sent on connect or periodically)
export interface CopilotSdkSessionListMessage extends BaseMessage<'copilot-sdk-session-list'> {
  payload: {
    requestId: string;
    sessions: CopilotSdkSessionInfo[];
  };
}

// Daemon → HQ: individual SDK session event (firehose)
export interface CopilotSdkSessionEventMessage extends BaseMessage<'copilot-sdk-session-event'> {
  payload: {
    sessionId: string;
    event: CopilotSessionEvent;
  };
}

// Daemon → HQ: SDK adapter connection state change
export interface CopilotSdkStateMessage extends BaseMessage<'copilot-sdk-state'> {
  payload: {
    state: CopilotSdkState;
    error?: string;
  };
}

export interface AttentionItemMessage extends BaseMessage<'attention-item'> {
  payload: {
    projectId: string;
    item: AttentionItem;
  };
}

// Daemon → HQ: batch session list (aggregator-facing, includes projectId)
export interface CopilotSessionListMessage extends BaseMessage<'copilot-session-list'> {
  payload: {
    projectId: string;
    sessions: CopilotSessionInfo[];
  };
}

// Daemon → HQ: individual session event with projectId (aggregator-facing)
export interface CopilotSessionEventMessage extends BaseMessage<'copilot-session-event'> {
  payload: {
    projectId: string;
    sessionId: string;
    event: CopilotSessionEvent;
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
  | TerminalExitMessage
  | CopilotSessionUpdateMessage
  | CopilotSessionListMessage
  | CopilotSessionEventMessage
  | CopilotConversationMessage
  | CopilotSdkSessionListMessage
  | CopilotSdkSessionEventMessage
  | CopilotSdkStateMessage
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

export interface TerminalSpawnMessage extends BaseMessage<'terminal-spawn'> {
  payload: {
    projectId: string;
    terminalId: string;
    cols?: number;
    rows?: number;
  };
}

export interface TerminalResizeMessage extends BaseMessage<'terminal-resize'> {
  payload: {
    projectId: string;
    terminalId: string;
    cols: number;
    rows: number;
  };
}

export interface TerminalKillMessage extends BaseMessage<'terminal-kill'> {
  payload: {
    projectId: string;
    terminalId: string;
  };
}

export interface RequestStatusMessage extends BaseMessage<'request-status'> {
  payload: {
    projectId: string;
  };
}

export interface CopilotCreateSessionMessage extends BaseMessage<'copilot-create-session'> {
  payload: {
    requestId: string;
    config?: SessionConfigWire;
  };
}

export interface CopilotResumeSessionMessage extends BaseMessage<'copilot-resume-session'> {
  payload: {
    requestId: string;
    sessionId: string;
    config?: Partial<SessionConfigWire>;
  };
}

export interface CopilotSendPromptMessage extends BaseMessage<'copilot-send-prompt'> {
  payload: {
    sessionId: string;
    prompt: string;
    attachments?: Array<{ type: string; path: string }>;
  };
}

export interface CopilotAbortSessionMessage extends BaseMessage<'copilot-abort-session'> {
  payload: {
    sessionId: string;
  };
}

export interface CopilotListSessionsMessage extends BaseMessage<'copilot-list-sessions'> {
  payload: {
    requestId: string;
  };
}

export type HqToDaemonMessage =
  | AuthChallengeMessage
  | AuthAcceptMessage
  | AuthRejectMessage
  | CommandMessage
  | TerminalInputMessage
  | TerminalSpawnMessage
  | TerminalResizeMessage
  | TerminalKillMessage
  | RequestStatusMessage
  | CopilotCreateSessionMessage
  | CopilotResumeSessionMessage
  | CopilotSendPromptMessage
  | CopilotAbortSessionMessage
  | CopilotListSessionsMessage;

// ---------------------------------------------------------------------------
// Combined union — every message that can travel over the wire
// ---------------------------------------------------------------------------

export type WsMessage = DaemonToHqMessage | HqToDaemonMessage;

/** All valid message type discriminants */
export type MessageType = WsMessage['type'];
