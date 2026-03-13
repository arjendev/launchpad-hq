// API response types matching server route contracts

export interface ProjectEntry {
  owner: string;
  repo: string;
  addedAt: string;
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

// ── Devcontainer types (match server containers/types.ts) ────

export type ContainerStatus = "running" | "stopped";

export interface DevContainer {
  containerId: string;
  name: string;
  status: ContainerStatus;
  workspaceFolder: string;
  repository?: string;
  ports: string[];
  image: string;
  createdAt: string;
}

export interface DiscoveryResult {
  containers: DevContainer[];
  scannedAt: string;
  dockerAvailable: boolean;
  error?: string;
}

export interface ContainerStatusUpdate {
  type: "container_status_update";
  containers: DevContainer[];
  changes: Array<{
    containerId: string;
    name: string;
    previousStatus: ContainerStatus | "absent";
    currentStatus: ContainerStatus | "absent";
  }>;
  scannedAt: string;
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
