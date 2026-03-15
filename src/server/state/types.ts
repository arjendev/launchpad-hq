import type { RuntimeTarget, WorkState } from "../../shared/protocol.js";

/** A tracked project (GitHub repo). */
export interface ProjectEntry {
  owner: string;
  repo: string;
  addedAt: string; // ISO 8601
  runtimeTarget: RuntimeTarget;
  initialized: boolean;
  daemonToken: string;
  workState: WorkState;
  /** Null/undefined means "use the default Copilot SDK agent". */
  defaultCopilotSdkAgent?: string | null;
}

/** Stored in config.json inside launchpad-state repo. */
export interface ProjectConfig {
  version: 1;
  projects: ProjectEntry[];
}

/** User display / behaviour preferences. Stored in preferences.json. */
export interface UserPreferences {
  version: 1;
  theme: "light" | "dark" | "system";
}

/** Per-project enrichment (devcontainer status, session links, etc.). */
export interface ProjectEnrichmentEntry {
  owner: string;
  repo: string;
  devcontainerStatus?: "active" | "inactive" | "unknown";
  sessionLinks?: string[];
  lastEnrichedAt?: string; // ISO 8601
}

/** Stored in enrichment.json inside launchpad-state repo. */
export interface EnrichmentData {
  version: 1;
  projects: Record<string, ProjectEnrichmentEntry>; // key = "owner/repo"
  updatedAt: string; // ISO 8601
}

/** Metadata GitHub returns alongside file content. */
export interface GitHubFileInfo {
  sha: string;
  content: string; // decoded
  path: string;
}

/** Shape of the state service exposed to the rest of the server. */
export interface StateService {
  getConfig(): Promise<ProjectConfig>;
  saveConfig(config: ProjectConfig): Promise<void>;
  getPreferences(): Promise<UserPreferences>;
  savePreferences(prefs: UserPreferences): Promise<void>;
  getEnrichment(): Promise<EnrichmentData>;
  saveEnrichment(data: EnrichmentData): Promise<void>;
  /** Force-pull all state files from GitHub. */
  sync(): Promise<void>;
  /** Find a project by its daemon auth token. */
  getProjectByToken(token: string): Promise<ProjectEntry | undefined>;
  /** Apply a partial update to a project entry (matched by owner/repo). */
  updateProjectState(
    owner: string,
    repo: string,
    updates: Partial<Pick<ProjectEntry, "initialized" | "workState" | "defaultCopilotSdkAgent">>,
  ): Promise<ProjectEntry | undefined>;
  /** Read the remembered Copilot SDK agent for a project. */
  getProjectDefaultCopilotAgent(
    owner: string,
    repo: string,
  ): Promise<string | null | undefined>;
  /** Update the remembered Copilot SDK agent for a project. */
  updateProjectDefaultCopilotAgent(
    owner: string,
    repo: string,
    agent: string | null,
  ): Promise<ProjectEntry | undefined>;
  /** Load a project's inbox from the state repo. */
  getInbox(owner: string, repo: string): Promise<ProjectInbox>;
  /** Persist a project's inbox to the state repo. */
  saveInbox(owner: string, repo: string, inbox: ProjectInbox): Promise<void>;
}

/** A single inbox message created by an agent tool invocation. */
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

/** Per-project inbox stored in launchpad-state repo. */
export interface ProjectInbox {
  version: 1;
  projectId: string;
  messages: InboxMessage[];
}

/**
 * Top-level launchpad configuration stored in ~/.launchpad/config.json.
 * Separate from ProjectConfig (which lives in the state repo).
 */
export interface LaunchpadConfig {
  version: 1;
  /** How launchpad persists state: "local" (filesystem only) or "git" (GitHub repo). */
  stateMode: "local" | "git";
  /** GitHub repo for git-backed state (e.g. "owner/repo"). Defaults to "launchpad-state". */
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

export function defaultLaunchpadConfig(): LaunchpadConfig {
  return {
    version: 1,
    stateMode: "local",
    copilot: {
      defaultSessionType: "sdk",
      defaultModel: "claude-opus-4.6",
    },
    tunnel: {
      mode: "on-demand",
      configured: false,
    },
    onboardingComplete: false,
  };
}

// ---- defaults ---------------------------------------------------------------

export function defaultProjectConfig(): ProjectConfig {
  return { version: 1, projects: [] };
}

export function defaultUserPreferences(): UserPreferences {
  return { version: 1, theme: "system" };
}

export function defaultEnrichmentData(): EnrichmentData {
  return { version: 1, projects: {}, updatedAt: new Date().toISOString() };
}

export function defaultProjectInbox(projectId: string): ProjectInbox {
  return { version: 1, projectId, messages: [] };
}
