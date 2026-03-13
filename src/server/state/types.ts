/** A tracked project (GitHub repo). */
export interface ProjectEntry {
  owner: string;
  repo: string;
  addedAt: string; // ISO 8601
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
