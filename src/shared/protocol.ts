/**
 * Daemon ↔ HQ WebSocket protocol types.
 *
 * All messages are discriminated unions keyed on the `type` field.
 * Types only — no runtime WebSocket code lives here.
 *
 * Copilot types are re-exported from @github/copilot-sdk — the SDK
 * is the source of truth.  Events flow as-is, no mapping.
 */

import type { PROTOCOL_VERSION } from './constants.js';

// ---------------------------------------------------------------------------
// SDK re-exports — source of truth for Copilot types
// ---------------------------------------------------------------------------

import type {
  ConnectionState,
  SessionEvent,
  SessionEventType,
  SessionMetadata,
  ModelInfo,
  GetAuthStatusResponse,
} from '@github/copilot-sdk';

export type { ConnectionState, SessionEvent, SessionEventType, SessionMetadata, ModelInfo, GetAuthStatusResponse };

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

/** A single message within a Copilot conversation */
export interface CopilotMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Where this message originated — omitted for normal VS Code messages */
  source?: 'hq-injection';
}

// ---------------------------------------------------------------------------
// HQ-specific enriched session (aggregator output)
// ---------------------------------------------------------------------------

/** Aggregated view of a session across daemons — HQ enrichment on top of SDK data */
export interface AggregatedSession {
  sessionId: string;
  daemonId: string;
  projectId: string;
  status: 'idle' | 'active' | 'error' | 'ended';
  model?: string;
  title?: string;
  mode?: string;
  summary?: string;
  startedAt: number;
  updatedAt: number;
  lastEvent?: { type: string; timestamp: number };
}

/** Tool definition (wire-safe — no handler) for session configuration */
export interface ToolDefinitionWire {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Session configuration sent over the wire (handler-free subset of SDK SessionConfig) */
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

export interface CopilotConversationMessage extends BaseMessage<'copilot-conversation'> {
  payload: {
    projectId: string;
    sessionId: string;
    messages: CopilotMessage[];
  };
}

// Daemon → HQ: batch session list — SDK SessionMetadata[] directly
export interface CopilotSessionListMessage extends BaseMessage<'copilot-session-list'> {
  payload: {
    projectId: string;
    requestId: string;
    sessions: SessionMetadata[];
  };
}

// Daemon → HQ: individual session event — SDK SessionEvent as-is
export interface CopilotSessionEventMessage extends BaseMessage<'copilot-session-event'> {
  payload: {
    projectId: string;
    sessionId: string;
    event: SessionEvent;
  };
}

// Daemon → HQ: SDK connection state change
export interface CopilotSdkStateMessage extends BaseMessage<'copilot-sdk-state'> {
  payload: {
    state: ConnectionState;
    error?: string;
  };
}

// Daemon → HQ: available models
export interface CopilotModelsListMessage extends BaseMessage<'copilot-models-list'> {
  payload: { models: ModelInfo[] };
}

// Daemon → HQ: auth status
export interface CopilotAuthStatusMessage extends BaseMessage<'copilot-auth-status'> {
  payload: { authenticated: boolean; user?: string; scopes?: string[] };
}

export interface AttentionItemMessage extends BaseMessage<'attention-item'> {
  payload: {
    projectId: string;
    item: AttentionItem;
  };
}

/** Tool names available to Copilot sessions for HQ communication */
export type CopilotHqToolName = 'report_progress' | 'request_human_review' | 'report_blocker';

export interface CopilotToolInvocationMessage extends BaseMessage<'copilot-tool-invocation'> {
  sessionId: string;
  projectId: string;
  tool: CopilotHqToolName;
  args: Record<string, unknown>;
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
  | CopilotSessionListMessage
  | CopilotSessionEventMessage
  | CopilotConversationMessage
  | CopilotSdkStateMessage
  | CopilotModelsListMessage
  | CopilotAuthStatusMessage
  | AttentionItemMessage
  | CopilotToolInvocationMessage
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
