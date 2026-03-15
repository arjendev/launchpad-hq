import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type {
  ProjectConfig,
  ProjectEntry,
  UserPreferences,
  EnrichmentData,
  ProjectInbox,
  LaunchpadConfig,
  StateService,
} from "./types.js";
import {
  defaultProjectConfig,
  defaultUserPreferences,
  defaultEnrichmentData,
  defaultProjectInbox,
  defaultLaunchpadConfig,
} from "./types.js";

const FILES = {
  config: "config.json",
  preferences: "preferences.json",
  enrichment: "enrichment.json",
  launchpadConfig: "launchpad-config.json",
} as const;

export interface LocalStateManagerOptions {
  /** Override the storage root for testing. Defaults to ~/.launchpad/state/. */
  root?: string;
}

/**
 * Filesystem-only state manager. All data lives under ~/.launchpad/state/.
 * No GitHub dependency — works fully offline.
 */
export class LocalStateManager implements StateService {
  private readonly root: string;

  constructor(opts?: LocalStateManagerOptions) {
    this.root = opts?.root ?? join(homedir(), ".launchpad", "state");
  }

  // ---- public API -----------------------------------------------------------

  async getConfig(): Promise<ProjectConfig> {
    return this.readJson(FILES.config, defaultProjectConfig);
  }

  async saveConfig(config: ProjectConfig): Promise<void> {
    await this.writeJson(FILES.config, config);
  }

  async getPreferences(): Promise<UserPreferences> {
    return this.readJson(FILES.preferences, defaultUserPreferences);
  }

  async savePreferences(prefs: UserPreferences): Promise<void> {
    await this.writeJson(FILES.preferences, prefs);
  }

  async getEnrichment(): Promise<EnrichmentData> {
    return this.readJson(FILES.enrichment, defaultEnrichmentData);
  }

  async saveEnrichment(data: EnrichmentData): Promise<void> {
    data.updatedAt = new Date().toISOString();
    await this.writeJson(FILES.enrichment, data);
  }

  async getLaunchpadConfig(): Promise<LaunchpadConfig> {
    return this.readJson(FILES.launchpadConfig, defaultLaunchpadConfig);
  }

  async saveLaunchpadConfig(config: LaunchpadConfig): Promise<void> {
    await this.writeJson(FILES.launchpadConfig, config);
  }

  async getInbox(owner: string, repo: string): Promise<ProjectInbox> {
    const path = this.inboxPath(owner, repo);
    return this.readJson(path, () => defaultProjectInbox(`${owner}/${repo}`));
  }

  async saveInbox(
    owner: string,
    repo: string,
    inbox: ProjectInbox,
  ): Promise<void> {
    const path = this.inboxPath(owner, repo);
    await this.writeJson(path, inbox);
  }

  /** No-op for local mode — everything is already on disk. */
  async sync(): Promise<void> {
    // Ensure the state directory exists with restrictive permissions.
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  /** No-op — local writes are immediate, no debouncing needed. */
  async flush(): Promise<void> {
    /* nothing pending */
  }

  async getProjectByToken(token: string): Promise<ProjectEntry | undefined> {
    const config = await this.getConfig();
    return config.projects.find((p) => p.daemonToken === token);
  }

  async updateProjectState(
    owner: string,
    repo: string,
    updates: Partial<
      Pick<ProjectEntry, "initialized" | "workState" | "defaultCopilotSdkAgent">
    >,
  ): Promise<ProjectEntry | undefined> {
    const config = await this.getConfig();
    const project = config.projects.find(
      (p) =>
        p.owner.toLowerCase() === owner.toLowerCase() &&
        p.repo.toLowerCase() === repo.toLowerCase(),
    );
    if (!project) return undefined;

    if (updates.initialized !== undefined) project.initialized = updates.initialized;
    if (updates.workState !== undefined) project.workState = updates.workState;
    if (updates.defaultCopilotSdkAgent !== undefined) {
      project.defaultCopilotSdkAgent = updates.defaultCopilotSdkAgent;
    }

    await this.saveConfig(config);
    return project;
  }

  async getProjectDefaultCopilotAgent(
    owner: string,
    repo: string,
  ): Promise<string | null | undefined> {
    const config = await this.getConfig();
    const project = config.projects.find(
      (p) =>
        p.owner.toLowerCase() === owner.toLowerCase() &&
        p.repo.toLowerCase() === repo.toLowerCase(),
    );
    return project ? project.defaultCopilotSdkAgent ?? null : undefined;
  }

  async updateProjectDefaultCopilotAgent(
    owner: string,
    repo: string,
    agent: string | null,
  ): Promise<ProjectEntry | undefined> {
    return this.updateProjectState(owner, repo, { defaultCopilotSdkAgent: agent });
  }

  // ---- internal helpers -----------------------------------------------------

  private resolve(path: string): string {
    return join(this.root, path);
  }

  private inboxPath(owner: string, repo: string): string {
    return `inbox/${owner}/${repo}.json`;
  }

  private async readJson<T>(path: string, defaultFn: () => T): Promise<T> {
    const filePath = this.resolve(path);
    if (!existsSync(filePath)) return defaultFn();
    try {
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return defaultFn();
    }
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    const filePath = this.resolve(path);
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
  }
}
