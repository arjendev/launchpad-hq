import { GitHubStateClient } from "./github-state-client.js";
import { LocalCache } from "./local-cache.js";
import type {
  ProjectConfig,
  UserPreferences,
  EnrichmentData,
  StateService,
} from "./types.js";
import {
  defaultProjectConfig,
  defaultUserPreferences,
  defaultEnrichmentData,
} from "./types.js";

const FILES = {
  config: "config.json",
  preferences: "preferences.json",
  enrichment: "enrichment.json",
} as const;

export interface StateManagerDeps {
  client: GitHubStateClient;
  cache: LocalCache;
}

export interface StateManagerOptions {
  token: string;
  owner: string;
  /** Override the cache root for testing. */
  cacheRoot?: string;
  /** Inject dependencies (for testing). */
  deps?: StateManagerDeps;
}

/**
 * Manages the user's launchpad-state GitHub repo.
 *
 * Read path:  local cache → GitHub API (on cache miss / startup sync)
 * Write path: GitHub API → local cache (write-through)
 */
export class StateManager implements StateService {
  private readonly client: GitHubStateClient;
  private readonly cache: LocalCache;

  constructor(opts: StateManagerOptions) {
    if (opts.deps) {
      this.client = opts.deps.client;
      this.cache = opts.deps.cache;
    } else {
      this.client = new GitHubStateClient(opts.token, opts.owner);
      this.cache = new LocalCache(opts.cacheRoot);
    }
  }

  // ---- public API -----------------------------------------------------------

  async getConfig(): Promise<ProjectConfig> {
    return this.readState(FILES.config, defaultProjectConfig);
  }

  async saveConfig(config: ProjectConfig): Promise<void> {
    await this.writeState(FILES.config, config);
  }

  async getPreferences(): Promise<UserPreferences> {
    return this.readState(FILES.preferences, defaultUserPreferences);
  }

  async savePreferences(prefs: UserPreferences): Promise<void> {
    await this.writeState(FILES.preferences, prefs);
  }

  async getEnrichment(): Promise<EnrichmentData> {
    return this.readState(FILES.enrichment, defaultEnrichmentData);
  }

  async saveEnrichment(data: EnrichmentData): Promise<void> {
    data.updatedAt = new Date().toISOString();
    await this.writeState(FILES.enrichment, data);
  }

  /**
   * Pull all state files from GitHub into the local cache.
   * Called once at startup to ensure cache is warm.
   */
  async sync(): Promise<void> {
    await this.client.ensureRepo();
    await Promise.all([
      this.pullFile(FILES.config),
      this.pullFile(FILES.preferences),
      this.pullFile(FILES.enrichment),
    ]);
  }

  // ---- internal helpers -----------------------------------------------------

  /**
   * Read a state file. Tries local cache first; falls back to GitHub.
   * Returns the provided default if the file doesn't exist anywhere.
   */
  private async readState<T>(
    path: string,
    defaultFn: () => T,
  ): Promise<T> {
    // Try cache first
    const cached = await this.cache.read(path);
    if (cached) {
      return JSON.parse(cached.content) as T;
    }

    // Fall back to GitHub
    const remote = await this.client.readFile(path);
    if (remote) {
      await this.cache.write(path, remote.content, remote.sha);
      return JSON.parse(remote.content) as T;
    }

    return defaultFn();
  }

  /**
   * Write a state file to GitHub then update local cache (write-through).
   * Uses last-write-wins: always reads the current SHA before writing.
   */
  private async writeState(path: string, data: unknown): Promise<void> {
    const content = JSON.stringify(data, null, 2) + "\n";

    // Get current SHA (needed by GitHub API for updates)
    let sha: string | undefined;
    const cached = await this.cache.read(path);
    if (cached) {
      sha = cached.sha;
    } else {
      const remote = await this.client.readFile(path);
      sha = remote?.sha;
    }

    const newSha = await this.client.writeFile(path, content, sha);
    await this.cache.write(path, content, newSha);
  }

  /** Pull a single file from GitHub into the cache. */
  private async pullFile(path: string): Promise<void> {
    const remote = await this.client.readFile(path);
    if (remote) {
      await this.cache.write(path, remote.content, remote.sha);
    }
  }
}
