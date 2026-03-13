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
