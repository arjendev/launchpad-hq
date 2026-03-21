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
  MessageOptions,
} from '@github/copilot-sdk';

export type { ConnectionState, SessionEvent, SessionEventType, SessionMetadata, ModelInfo, GetAuthStatusResponse };

// ---------------------------------------------------------------------------
// Session integration variants
// ---------------------------------------------------------------------------

/** Integration variant for a Copilot session */
export type SessionType = 'copilot-cli' | 'copilot-sdk';

/** Delivery mode for a prompt sent to an active Copilot session */
export type PromptDeliveryMode = NonNullable<MessageOptions['mode']>;

/** SDK session mode values exposed through session.rpc.mode.* */
export type CopilotSessionMode = 'interactive' | 'plan' | 'autopilot';

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
  agentCatalog?: CopilotAgentCatalogEntry[];
}

/** A single message within a Copilot conversation */
export interface CopilotMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Where this message originated — omitted for normal VS Code messages */
  source?: 'hq-injection';
  /** Optional metadata preserved from SDK events (subagent context, model info, etc.) */
  metadata?: CopilotMessageMetadata;
}

/** Rich metadata attached to a CopilotMessage so it survives REST round-trips */
export interface CopilotMessageMetadata {
  parentToolCallId?: string;
  subagentName?: string;
  agentName?: string;
  model?: string;
  initiator?: string;
}

// ---------------------------------------------------------------------------
// HQ-specific enriched session (aggregator output)
// ---------------------------------------------------------------------------

/** High-level phase derived from SDK event flow */
export type SessionPhase =
  | 'idle'
  | 'thinking'
  | 'tool'
  | 'subagent'
  | 'waiting'
  | 'error';

/** An active tool call tracked by the aggregator */
export interface ActiveToolCall {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  progress?: string;
}

/** An active subagent tracked by the aggregator */
export interface ActiveSubagent {
  id: string;
  name: string;
  displayName?: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  intent?: string;
  activeToolCalls: ActiveToolCall[];
  recentEvents: Array<{ type: string; summary: string; timestamp: number }>;
}

/** A background task reported by the SDK while session is idle */
export interface BackgroundTask {
  id: string;
  description: string;
  status: 'running' | 'completed';
}

/** State when the SDK is waiting for user input */
export interface WaitingState {
  type: 'user-input' | 'elicitation' | 'plan-exit' | 'permission';
  requestId: string;
  question?: string;
  choices?: string[];
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

/** Structured activity state derived from SDK events */
export interface SessionActivity {
  phase: SessionPhase;
  intent: string | null;
  activeToolCalls: ActiveToolCall[];
  activeSubagents: ActiveSubagent[];
  backgroundTasks: BackgroundTask[];
  waitingState: WaitingState | null;
  tokenUsage: { used: number; limit?: number } | null;
  turnCount: number;
}

/** Aggregated view of a session — client-facing (no internal routing fields) */
export interface AggregatedSession {
  sessionId: string;
  sessionType?: SessionType;
  status: 'idle' | 'active' | 'error' | 'ended';
  model?: string;
  title?: string;
  mode?: CopilotSessionMode;
  summary?: string;
  startedAt: number;
  updatedAt: number;
  lastEvent?: { type: string; timestamp: number };
  activity: SessionActivity;
}

/** Tool definition (wire-safe — no handler) for session configuration */
export interface ToolDefinitionWire {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Advertised Copilot agent entry available for session creation */
export interface CopilotAgentCatalogEntry {
  id: string;
  name: string;
  displayName?: string;
  description: string;
  kind: 'default' | 'custom';
  source: 'builtin' | 'github-agent-file';
  path?: string;
  model?: string;
  tools?: string[];
  userInvocable?: boolean;
  target?: string;
}

/** Session configuration sent over the wire (handler-free subset of SDK SessionConfig) */
export interface SessionConfigWire {
  sessionType?: SessionType;
  model?: string;
  agentId?: string | null;
  systemMessage?: { mode: 'append' | 'replace'; content: string };
  tools?: ToolDefinitionWire[];
  streaming?: boolean;
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
  /** W3C Trace Context propagation header (injected by HQ when OTEL is active) */
  traceparent?: string;
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
    sessionType?: SessionType;
    event: SessionEvent;
  };
}

// Daemon → HQ: available custom-agent catalog for this project
export interface CopilotAgentCatalogMessage extends BaseMessage<'copilot-agent-catalog'> {
  payload: {
    projectId: string;
    agents: CopilotAgentCatalogEntry[];
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
  payload: { requestId: string; models: ModelInfo[] };
}

// Daemon → HQ: mode query response
export interface CopilotModeResponseMessage extends BaseMessage<'copilot-mode-response'> {
  payload: { requestId: string; sessionId: string; mode: CopilotSessionMode };
}

export interface CopilotPlanResponseMessage extends BaseMessage<'copilot-plan-response'> {
  payload: { requestId: string; sessionId: string; plan: { exists: boolean; content: string | null; path: string | null } };
}

export interface CopilotAgentResponseMessage extends BaseMessage<'copilot-agent-response'> {
  payload: {
    requestId: string;
    sessionId: string;
    agentId: string | null;
    agentName: string | null;
    error?: string;
  };
}

// Daemon → HQ: auth status
export interface CopilotAuthStatusMessage extends BaseMessage<'copilot-auth-status'> {
  payload: { authenticated: boolean; user?: string; scopes?: string[] };
}

// ---------------------------------------------------------------------------
// Preview proxy messages (app preview via HQ tunnel)
// ---------------------------------------------------------------------------

/** Daemon → HQ: daemon reports its preview port config */
export interface PreviewConfigMessage extends BaseMessage<'preview-config'> {
  payload: {
    projectId: string;
    port: number;
    autoDetected: boolean;
    detectedFrom?: 'config' | 'devcontainer' | 'port-scan' | 'package-json';
  };
}

/** HQ → Daemon: proxy an HTTP request to the project's local dev server */
export interface PreviewProxyRequestMessage extends BaseMessage<'preview-proxy-request'> {
  payload: {
    requestId: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string; // base64 encoded for binary
  };
}

/** Daemon → HQ: proxy response back from the project's local dev server */
export interface PreviewProxyResponseMessage extends BaseMessage<'preview-proxy-response'> {
  payload: {
    requestId: string;
    statusCode: number;
    headers: Record<string, string>;
    body: string; // base64 encoded
  };
}

/** HQ → Daemon: open a WebSocket channel to the local dev server */
export interface PreviewWsOpenMessage extends BaseMessage<'preview-ws-open'> {
  payload: {
    channelId: string;
    path: string;
    headers: Record<string, string>;
  };
}

/** HQ ↔ Daemon: relay WebSocket data */
export interface PreviewWsDataMessage extends BaseMessage<'preview-ws-data'> {
  payload: {
    channelId: string;
    data: string; // base64
  };
}

/** HQ ↔ Daemon: close a WebSocket channel */
export interface PreviewWsCloseMessage extends BaseMessage<'preview-ws-close'> {
  payload: {
    channelId: string;
    code?: number;
    reason?: string;
  };
}

// ---------------------------------------------------------------------------
// Workflow / Coordinator types (Phase 2 — Autonomous Dispatch #72)
// ---------------------------------------------------------------------------

/** Status of the coordinator process managed by a daemon */
export type CoordinatorStatus = 'idle' | 'starting' | 'active' | 'crashed' | 'stopped';

/** Status of an individual dispatch */
export type DispatchStatus = 'pending' | 'in-progress' | 'dispatched' | 'completed' | 'failed';

/** A record of a single issue dispatch to the coordinator */
export interface DispatchRecord {
  issueNumber: number;
  status: DispatchStatus;
  dispatchedAt: string;
  completedAt?: string;
  error?: string;
}

/** Persisted coordinator state for a project */
export interface CoordinatorProjectState {
  status: CoordinatorStatus;
  sessionId: string | null;
  lastSeenAt: string | null;
  startedAt: string | null;
  error: string | null;
  dispatches: DispatchRecord[];
}

/** A commit associated with an issue */
export interface TrackedCommit {
  sha: string;
  message: string;
  issueNumbers: number[];
  author: string | null;
  timestamp: string;
}

/** Issue data sent to the coordinator for dispatch */
export interface WorkflowIssuePayload {
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
  feedback?: string;
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

/** Daemon → HQ: agent requests permission for a tool call */
export interface CopilotPermissionRequestMessage extends BaseMessage<'copilot-permission-request'> {
  payload: {
    projectId: string;
    sessionId: string;
    requestId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
  };
}

/** Daemon → HQ: agent requests user input */
export interface CopilotUserInputRequestMessage extends BaseMessage<'copilot-user-input-request'> {
  payload: {
    projectId: string;
    sessionId: string;
    requestId: string;
    question: string;
    choices?: string[];
  };
}

// ---------------------------------------------------------------------------
// Elicitation relay messages (Phase 3 — Elicitation Relay #72)
// ---------------------------------------------------------------------------

/** JSON Schema describing the form fields for an elicitation request */
export interface ElicitationSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/** Daemon → HQ: SDK session requests user input via elicitation */
export interface WorkflowElicitationRequestedMessage extends BaseMessage<'workflow:elicitation-requested'> {
  payload: {
    projectId: string;
    sessionId: string;
    elicitationId: string;
    message: string;
    mode?: 'form';
    requestedSchema: ElicitationSchema;
    issueNumber?: number;
  };
}

/** HQ → Daemon: user responded to an elicitation request */
export interface WorkflowElicitationResponseMessage extends BaseMessage<'workflow:elicitation-response'> {
  payload: {
    projectId: string;
    sessionId: string;
    elicitationId: string;
    response: Record<string, unknown>;
  };
}

/** Daemon → HQ: elicitation timed out without a response */
export interface WorkflowElicitationTimeoutMessage extends BaseMessage<'workflow:elicitation-timeout'> {
  payload: {
    projectId: string;
    sessionId: string;
    elicitationId: string;
  };
}

// ---------------------------------------------------------------------------
// Workflow coordinator messages (Daemon → HQ)
// ---------------------------------------------------------------------------

/** Daemon → HQ: coordinator session started successfully */
export interface WorkflowCoordinatorStartedMessage extends BaseMessage<'workflow:coordinator-started'> {
  payload: {
    projectId: string;
    sessionId: string;
    resumed: boolean;
  };
}

/** Daemon → HQ: coordinator session crashed or errored */
export interface WorkflowCoordinatorCrashedMessage extends BaseMessage<'workflow:coordinator-crashed'> {
  payload: {
    projectId: string;
    sessionId: string | null;
    error: string;
    willRetry: boolean;
    retryAttempt: number;
  };
}

/** Daemon → HQ: coordinator health ping */
export interface WorkflowCoordinatorHealthMessage extends BaseMessage<'workflow:coordinator-health'> {
  payload: {
    projectId: string;
    sessionId: string;
    state: CoordinatorStatus;
    uptimeMs: number;
    dispatched: number;
  };
}

/** Daemon → HQ: progress update for an issue being worked on */
export interface WorkflowProgressMessage extends BaseMessage<'workflow:progress'> {
  payload: {
    projectId: string;
    sessionId: string;
    issueNumber: number;
    event: SessionEvent;
  };
}

/** Daemon → HQ: issue implementation completed */
export interface WorkflowIssueCompletedMessage extends BaseMessage<'workflow:issue-completed'> {
  payload: {
    projectId: string;
    sessionId: string;
    issueNumber: number;
    summary: string;
  };
}

/** Daemon → HQ: issue dispatch has started */
export interface WorkflowDispatchStartedMessage extends BaseMessage<'workflow:dispatch-started'> {
  payload: {
    projectId: string;
    sessionId: string;
    issueNumber: number;
    title: string;
  };
}

// ---------------------------------------------------------------------------
// Workflow coordinator messages (HQ → Daemon)
// ---------------------------------------------------------------------------

/** HQ → Daemon: start or resume a coordinator session */
export interface WorkflowStartCoordinatorMessage extends BaseMessage<'workflow:start-coordinator'> {
  payload: {
    projectId: string;
    sessionId?: string;
  };
}

/** HQ → Daemon: stop coordinator gracefully */
export interface WorkflowStopCoordinatorMessage extends BaseMessage<'workflow:stop-coordinator'> {
  payload: {
    projectId: string;
  };
}

/** HQ → Daemon: dispatch an issue to the coordinator */
export interface WorkflowDispatchIssueMessage extends BaseMessage<'workflow:dispatch-issue'> {
  payload: {
    projectId: string;
    issueNumber: number;
    title: string;
    labels: string[];
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
  | CopilotAgentCatalogMessage
  | CopilotConversationMessage
  | CopilotSdkStateMessage
  | CopilotModelsListMessage
  | CopilotModeResponseMessage
  | CopilotPlanResponseMessage
  | CopilotAgentResponseMessage
  | CopilotAuthStatusMessage
  | CopilotToolInvocationMessage
  | AuthResponseMessage
  | CopilotPermissionRequestMessage
  | CopilotUserInputRequestMessage
  | PreviewConfigMessage
  | PreviewProxyResponseMessage
  | PreviewWsDataMessage
  | PreviewWsCloseMessage
  | WorkflowCoordinatorStartedMessage
  | WorkflowCoordinatorCrashedMessage
  | WorkflowCoordinatorHealthMessage
  | WorkflowDispatchStartedMessage
  | WorkflowProgressMessage
  | WorkflowIssueCompletedMessage
  | WorkflowElicitationRequestedMessage
  | WorkflowElicitationTimeoutMessage;

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

// HQ→daemon terminal messages.
// These carry `projectId` + `sessionId`/`terminalId` and extend BaseMessage.
// NOTE: ws/types.ts defines separate browser→HQ terminal types (TerminalInputMessage,
// TerminalResizeMessage, etc.) that carry `daemonId` instead. The two sets are
// intentionally distinct — different audiences, different wire formats.
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
    sessionType?: SessionType;
    config?: SessionConfigWire;
  };
}

export interface CopilotResumeSessionMessage extends BaseMessage<'copilot-resume-session'> {
  payload: {
    requestId: string;
    sessionId: string;
    sessionType?: SessionType;
    config?: Partial<SessionConfigWire>;
  };
}

export interface CopilotSendPromptMessage extends BaseMessage<'copilot-send-prompt'> {
  payload: {
    sessionId: string;
    prompt: string;
    attachments?: MessageOptions['attachments'];
    mode?: PromptDeliveryMode;
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

// HQ → Daemon: session control messages
export interface CopilotSetModelMessage extends BaseMessage<'copilot-set-model'> {
  payload: { sessionId: string; model: string };
}

export interface CopilotGetModeMessage extends BaseMessage<'copilot-get-mode'> {
  payload: { requestId: string; sessionId: string };
}

export interface CopilotSetModeMessage extends BaseMessage<'copilot-set-mode'> {
  payload: { sessionId: string; mode: CopilotSessionMode };
}

export interface CopilotGetAgentMessage extends BaseMessage<'copilot-get-agent'> {
  payload: { requestId: string; sessionId: string };
}

export interface CopilotSetAgentMessage extends BaseMessage<'copilot-set-agent'> {
  payload: { requestId: string; sessionId: string; agentId: string | null };
}

export interface CopilotGetPlanMessage extends BaseMessage<'copilot-get-plan'> {
  payload: { requestId: string; sessionId: string };
}

export interface CopilotUpdatePlanMessage extends BaseMessage<'copilot-update-plan'> {
  payload: { sessionId: string; content: string };
}

export interface CopilotDeletePlanMessage extends BaseMessage<'copilot-delete-plan'> {
  payload: { sessionId: string };
}

export interface CopilotDisconnectSessionMessage extends BaseMessage<'copilot-disconnect-session'> {
  payload: { sessionId: string };
}

export interface CopilotListModelsMessage extends BaseMessage<'copilot-list-models'> {
  payload: { requestId: string };
}

export interface CopilotDeleteSessionMessage extends BaseMessage<'copilot-delete-session'> {
  payload: { sessionId: string };
}

/** HQ → Daemon: permission decision from user */
export interface CopilotPermissionResponseMessage extends BaseMessage<'copilot-permission-response'> {
  payload: {
    requestId: string;
    sessionId: string;
    decision: 'allow' | 'deny';
  };
}

/** HQ → Daemon: user input response */
export interface CopilotUserInputResponseMessage extends BaseMessage<'copilot-user-input-response'> {
  payload: {
    requestId: string;
    sessionId: string;
    answer: string;
    wasFreeform: boolean;
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
  | CopilotListSessionsMessage
  | CopilotSetModelMessage
  | CopilotGetModeMessage
  | CopilotSetModeMessage
  | CopilotGetAgentMessage
  | CopilotSetAgentMessage
  | CopilotGetPlanMessage
  | CopilotUpdatePlanMessage
  | CopilotDeletePlanMessage
  | CopilotDisconnectSessionMessage
  | CopilotListModelsMessage
  | CopilotDeleteSessionMessage
  | CopilotPermissionResponseMessage
  | CopilotUserInputResponseMessage
  | PreviewProxyRequestMessage
  | PreviewWsOpenMessage
  | PreviewWsDataMessage
  | PreviewWsCloseMessage
  | WorkflowStartCoordinatorMessage
  | WorkflowStopCoordinatorMessage
  | WorkflowDispatchIssueMessage
  | WorkflowElicitationResponseMessage;

// ---------------------------------------------------------------------------
// Combined union — every message that can travel over the wire
// ---------------------------------------------------------------------------

export type WsMessage = DaemonToHqMessage | HqToDaemonMessage;

/** All valid message type discriminants */
export type MessageType = WsMessage['type'];

// ---------------------------------------------------------------------------
// Shared utility types
// ---------------------------------------------------------------------------

/** Callback used by daemon modules to send messages to HQ */
export type SendToHq = (msg: DaemonToHqMessage) => void;
