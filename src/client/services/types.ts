// API response types matching server route contracts

export interface ProjectEntry {
  owner: string;
  repo: string;
  addedAt: string;
  runtimeTarget: string;
  initialized: boolean;
  daemonStatus: "online" | "offline";
  workState: string;
  lastSeen?: number;
  daemonToken?: string;
}

export interface ListProjectsResponse {
  projects: ProjectEntry[];
  count: number;
}

export interface DashboardProject {
  owner: string;
  repo: string;
  openIssueCount: number;
  openPrCount: number;
  updatedAt: string;
  isArchived: boolean;
  runtimeTarget: string;
  daemonStatus: "online" | "offline";
  workState: string;
}

export interface DashboardResponse {
  totalProjects: number;
  totalOpenIssues: number;
  totalOpenPrs: number;
  projects: DashboardProject[];
}

export interface AddProjectRequest {
  owner: string;
  repo: string;
  runtimeTarget?: string;
}

// ── Discover types (match server /api/discover endpoints) ────

export interface DiscoverUser {
  login: string;
  type: "User" | "Organization";
  avatarUrl: string;
}

export interface DiscoverUsersResponse {
  users: DiscoverUser[];
}

export interface DiscoverRepo {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  url: string;
  private: boolean;
  language: string | null;
  updatedAt: string;
  tracked: boolean;
}

export interface DiscoverReposResponse {
  repos: DiscoverRepo[];
  page: number;
  perPage: number;
}

export interface ApiError {
  error: string;
  message: string;
}

// Issue/PR types matching server GraphQL response shape

export interface GitHubLabel {
  name: string;
  color: string;
}

export interface GitHubAssignee {
  login: string;
  avatarUrl: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  author: { login: string; avatarUrl: string } | null;
  labels: GitHubLabel[];
  assignees: GitHubAssignee[];
}

export interface IssuesResponse {
  issues: GitHubIssue[];
  hasNextPage: boolean;
  endCursor: string | null;
  totalFiltered: number;
}

// ── GitHub entity types (match server GraphQL types) ────

export interface GitHubLabel {
  name: string;
  color: string;
}

export interface GitHubActor {
  login: string;
  avatarUrl: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  url: string;
  labels: GitHubLabel[];
  assignees: GitHubActor[];
  createdAt: string;
  updatedAt: string;
}

export interface IssuesResponse {
  issues: GitHubIssue[];
  hasNextPage: boolean;
  endCursor: string | null;
  totalFiltered: number;
}

// ── Daemon types (match server daemon-registry/registry.ts) ────

export type DaemonConnectionState = "authenticating" | "connected" | "disconnected";

export interface DaemonSummary {
  daemonId: string;
  projectId: string;
  projectName: string;
  runtimeTarget: string;
  state: DaemonConnectionState;
  connectedAt: number;
  lastHeartbeat: number;
  disconnectedAt?: number;
  version: string;
  capabilities: string[];
}

// ── SDK re-exports — source of truth for Copilot event types ────

import type { SessionEventType, SessionEvent } from "@github/copilot-sdk";

/** SDK session event type names (re-exported for convenience) */
export type CopilotSessionEventType = SessionEventType;

/** SDK session event (re-exported for convenience) */
export type CopilotSessionEvent = SessionEvent;

// ── Aggregated Copilot session types (match server copilot-aggregator) ────

export type AggregatedSessionStatus = "active" | "idle" | "error" | "ended";

/** High-level phase derived from SDK event flow */
export type SessionPhase =
  | "idle"
  | "thinking"
  | "tool"
  | "subagent"
  | "waiting"
  | "error";

/** An active tool call tracked by the aggregator */
export interface ActiveToolCall {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  progress?: string;
}

/** An active subagent tracked by the aggregator */
export interface ActiveSubagent {
  id: string;
  name: string;
  displayName?: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  intent?: string;
  activeToolCalls: ActiveToolCall[];
  recentEvents: Array<{ type: string; summary: string; timestamp: number }>;
}

/** A background task reported by the SDK while session is idle */
export interface BackgroundTask {
  id: string;
  description: string;
  status: "running" | "completed";
}

/** State when the SDK is waiting for user input */
export interface WaitingState {
  type: "user-input" | "elicitation" | "plan-exit" | "permission";
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

/** Default idle activity state — useful for tests and initial values */
export const DEFAULT_SESSION_ACTIVITY: SessionActivity = {
  phase: "idle",
  intent: null,
  activeToolCalls: [],
  activeSubagents: [],
  backgroundTasks: [],
  waitingState: null,
  tokenUsage: null,
  turnCount: 0,
};

export interface AggregatedSession {
  sessionId: string;
  sessionType?: "copilot-cli" | "copilot-sdk";
  status: AggregatedSessionStatus;
  model?: string;
  title?: string;
  mode?: CopilotSessionMode;
  summary?: string;
  startedAt: number;
  updatedAt: number;
  lastEvent?: { type: string; timestamp: number };
  activity: SessionActivity;
}

export type CopilotSessionMode = "interactive" | "plan" | "autopilot";
export type PromptDeliveryMode = "enqueue" | "immediate";

// ── New endpoint response types ────

export interface ModeResponse {
  sessionId: string;
  mode: CopilotSessionMode;
}

export interface PlanResponse {
  sessionId: string;
  content: string;
}

export interface CopilotModel {
  id: string;
  name: string;
  capabilities?: Record<string, unknown>;
}

export interface ModelsResponse {
  models: CopilotModel[];
}

export interface CopilotAgentCatalogEntry {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  userInvocable?: boolean;
}

export interface CopilotAgentCatalogResponse {
  agents: CopilotAgentCatalogEntry[];
}

export interface CopilotAgentPreferenceResponse {
  agentId: string | null;
  agentName?: string | null;
}

export interface CopilotSessionAgentResponse {
  sessionId: string;
  agentId: string | null;
  agentName: string | null;
}

export interface AggregatedSessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: {
    parentToolCallId?: string;
    subagentName?: string;
    agentName?: string;
    model?: string;
    initiator?: string;
  };
}

export interface SessionMessagesResponse {
  sessionId: string;
  messages: AggregatedSessionMessage[];
  count: number;
}

export interface ToolInvocationRecord {
  sessionId: string;
  projectId: string;
  tool: "report_progress" | "request_human_review" | "report_blocker";
  args: Record<string, unknown>;
  timestamp: number;
}

export interface SessionToolsResponse {
  sessionId: string;
  invocations: ToolInvocationRecord[];
  count: number;
}

/** Unified entry type for the conversation viewer */
export type ConversationEntryType =
  | "user"
  | "assistant"
  | "tool"
  | "hq-tool"
  | "status"
  | "error"
  | "event";

export interface ConversationEntry {
  id: string;
  type: ConversationEntryType;
  content: string;
  timestamp: number;
  toolName?: string;
  toolStatus?: "running" | "completed" | "failed";
  hqToolName?: string;
  hqToolArgs?: Record<string, unknown>;
  isStreaming?: boolean;
  eventType?: string;
  eventData?: Record<string, unknown>;
}

// ── Copilot session types (match server copilot/types.ts) ────

export type ConversationRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  timestamp: string;
}

export type SessionStatus = "active" | "idle" | "completed" | "error";

export interface CopilotSession {
  id: string;
  status: SessionStatus;
  startedAt: string;
  repository: string | null;
  currentTask: string | null;
  conversationHistory: ConversationMessage[];
  adapter: "mock" | "sdk";
}

export interface CopilotSessionSummary {
  id: string;
  status: SessionStatus;
  startedAt: string;
  repository: string | null;
  currentTask: string | null;
  messageCount: number;
  adapter: "mock" | "sdk";
}

// ── Attention types (match server attention/types.ts) ────

export type AttentionType = "issue_stale" | "pr_needs_review" | "ci_failing" | "session_idle";

export type AttentionSeverity = "info" | "warning" | "critical";

export interface AttentionItem {
  id: string;
  type: AttentionType;
  severity: AttentionSeverity;
  project: string;
  message: string;
  createdAt: string;
  url?: string;
  sourceId?: string;
  dismissed: boolean;
}

export interface AttentionCountResponse {
  total: number;
  bySeverity: Record<AttentionSeverity, number>;
}

// ── Inbox types (match server state/types.ts) ────

export interface InboxMessage {
  id: string;
  projectId: string;
  sessionId: string;
  tool: "request_human_review" | "report_blocker";
  args: Record<string, unknown>;
  title: string;
  status: "unread" | "read" | "archived";
  createdAt: string;
  readAt?: string;
  archivedAt?: string;
}

export interface InboxListResponse {
  messages: InboxMessage[];
  total: number;
  unread: number;
}

export interface InboxCountResponse {
  unread: number;
}

// ── Tunnel types (match server /api/tunnel routes) ────

export type TunnelStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface TunnelInfo {
  url: string;
  tunnelId: string;
  port: number;
}

export interface TunnelState {
  status: TunnelStatus;
  info: TunnelInfo | null;
  shareUrl: string | null;
  error: string | null;
  /** True when the tunnel is actually running. */
  configured: boolean;
}

export interface TunnelQrResponse {
  shareUrl: string;
  qrDataUrl: string;
}

// ── Preview types (match server /api/preview routes) ────────────────────────

export interface PreviewEntry {
  projectId: string;
  port: number;
  autoDetected: boolean;
  detectedFrom?: string;
}

export interface PreviewState extends PreviewEntry {
  available: boolean;
}

export interface PreviewQrResponse {
  previewUrl: string;
  qrDataUrl: string;
}

// ── Settings (LaunchpadConfig) ──────────────────────────────────────────────

export interface LaunchpadConfig {
  version: 1;
  stateMode: "local" | "git";
  /** GitHub repo for git state storage, e.g. "owner/repo". Only used when stateMode is "git". */
  stateRepo?: string;
  copilot: {
    defaultSessionType: "sdk" | "cli";
    defaultModel: string;
  };
  tunnel: {
    mode: "always" | "on-demand";
    configured: boolean;
  };
  onboardingComplete: boolean;
}
