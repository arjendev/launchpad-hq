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
  runtimeTarget: string;
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

import type { SessionEventType, SessionEvent } from '@github/copilot-sdk';

/** SDK session event type names (re-exported for convenience) */
export type CopilotSessionEventType = SessionEventType;

/** SDK session event (re-exported for convenience) */
export type CopilotSessionEvent = SessionEvent;

// ── Aggregated Copilot session types (match server copilot-aggregator) ────

export type AggregatedSessionStatus = "active" | "idle" | "error" | "ended";

export interface AggregatedSession {
  sessionId: string;
  sessionType?: 'copilot-cli' | 'copilot-sdk' | 'squad-sdk';
  status: AggregatedSessionStatus;
  model?: string;
  title?: string;
  mode?: string;
  summary?: string;
  startedAt: number;
  updatedAt: number;
  lastEvent?: { type: string; timestamp: number };
}

// ── New endpoint response types ────

export interface ModeResponse {
  sessionId: string;
  mode: string;
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

export interface AggregatedSessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
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

export type AttentionType =
  | "issue_stale"
  | "pr_needs_review"
  | "ci_failing"
  | "session_idle";

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
