import { GitHubStateClient, ShaConflictError } from "./github-state-client.js";
import { LocalCache } from "./local-cache.js";
import type {
  ProjectConfig,
  ProjectEntry,
  UserPreferences,
  EnrichmentData,
  LaunchpadConfig,
  StateService,
} from "./types.js";
import {
  defaultProjectConfig,
  defaultUserPreferences,
  defaultEnrichmentData,
  defaultLaunchpadConfig,
} from "./types.js";

const FILES = {
  config: "config.json",
  preferences: "preferences.json",
  enrichment: "enrichment.json",
  launchpadConfig: "launchpad-config.json",
} as const;

/** Default debounce delay in milliseconds. */
const DEBOUNCE_MS = 2_000;

export interface StateManagerDeps {
  client: GitHubStateClient;
  cache: LocalCache;
}

export interface StateManagerOptions {
  token: string;
  owner: string;
  /** Override the state repo name (default: "launchpad-state"). */
  repo?: string;
  /** Override the cache root for testing. */
  cacheRoot?: string;
  /** Inject dependencies (for testing). */
  deps?: StateManagerDeps;
  /** Override debounce delay in ms (default: 2000). Set to 0 to disable debouncing. */
  debounceMs?: number;
}

interface PendingWrite {
  data: unknown;
  timer: ReturnType<typeof setTimeout>;
  waiters: Array<{ resolve: () => void; reject: (err: Error) => void }>;
}

/**
 * Git-backed state manager that persists to the user's launchpad-state GitHub repo.
 *
 * Read path:  local cache → GitHub API (on cache miss / startup sync)
 * Write path: GitHub API → local cache (write-through)
 *
 * Writes are debounced per file path: rapid successive calls coalesce into a
 * single GitHub API write after a configurable delay. All callers receive a
 * promise that resolves (or rejects) when the actual write completes.
 *
 * On 409 SHA conflicts the write is retried once after refreshing the SHA.
 */
export class GitStateManager implements StateService {
  private readonly client: GitHubStateClient;
  private readonly cache: LocalCache;
  private readonly debounceMs: number;
  private readonly pendingWrites = new Map<string, PendingWrite>();

  constructor(opts: StateManagerOptions) {
    if (opts.deps) {
      this.client = opts.deps.client;
      this.cache = opts.deps.cache;
    } else {
      this.client = new GitHubStateClient(opts.token, opts.owner, opts.repo);
      this.cache = new LocalCache(opts.cacheRoot);
    }
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
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

  async getLaunchpadConfig(): Promise<LaunchpadConfig> {
    return this.readState(FILES.launchpadConfig, defaultLaunchpadConfig);
  }

  async saveLaunchpadConfig(config: LaunchpadConfig): Promise<void> {
    await this.writeState(FILES.launchpadConfig, config);
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
      this.pullFile(FILES.launchpadConfig),
    ]);
  }

  /**
   * Flush all pending debounced writes immediately.
   * Call this on server shutdown to ensure no data is lost.
   */
  async flush(): Promise<void> {
    const paths = [...this.pendingWrites.keys()];
    await Promise.all(paths.map((p) => this.executePendingWrite(p)));
  }

  async getProjectByToken(token: string): Promise<ProjectEntry | undefined> {
    const config = await this.getConfig();
    return config.projects.find((p) => p.daemonToken === token);
  }

  async updateProjectState(
    owner: string,
    repo: string,
    updates: Partial<Pick<ProjectEntry, "initialized" | "workState" | "defaultCopilotSdkAgent" | "autonomousCopilotSdkAgent">>,
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
    if (updates.autonomousCopilotSdkAgent !== undefined) {
      project.autonomousCopilotSdkAgent = updates.autonomousCopilotSdkAgent;
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

  async getProjectAutonomousCopilotAgent(
    owner: string,
    repo: string,
  ): Promise<string | null | undefined> {
    const config = await this.getConfig();
    const project = config.projects.find(
      (p) =>
        p.owner.toLowerCase() === owner.toLowerCase() &&
        p.repo.toLowerCase() === repo.toLowerCase(),
    );
    return project ? project.autonomousCopilotSdkAgent ?? null : undefined;
  }

  async updateProjectAutonomousCopilotAgent(
    owner: string,
    repo: string,
    agent: string | null,
  ): Promise<ProjectEntry | undefined> {
    return this.updateProjectState(owner, repo, { autonomousCopilotSdkAgent: agent });
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
   * Schedule a debounced write for the given path.
   * Returns a promise that resolves when the write eventually completes.
   * If debounceMs is 0, writes immediately (useful for testing).
   */
  private writeState(path: string, data: unknown): Promise<void> {
    if (this.debounceMs <= 0) {
      return this.doWrite(path, data);
    }

    return new Promise<void>((resolve, reject) => {
      const existing = this.pendingWrites.get(path);
      if (existing) {
        clearTimeout(existing.timer);
        existing.data = data;
        existing.waiters.push({ resolve, reject });
        existing.timer = setTimeout(
          () => void this.executePendingWrite(path),
          this.debounceMs,
        );
      } else {
        const pending: PendingWrite = {
          data,
          timer: setTimeout(
            () => void this.executePendingWrite(path),
            this.debounceMs,
          ),
          waiters: [{ resolve, reject }],
        };
        this.pendingWrites.set(path, pending);
      }
    });
  }

  /**
   * Execute a pending write immediately, resolving/rejecting all waiters.
   * Safe to call even if the path has no pending write.
   */
  private async executePendingWrite(path: string): Promise<void> {
    const pending = this.pendingWrites.get(path);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingWrites.delete(path);

    try {
      await this.doWrite(path, pending.data);
      for (const w of pending.waiters) w.resolve();
    } catch (err) {
      for (const w of pending.waiters) w.reject(err as Error);
    }
  }

  /**
   * Perform the actual GitHub write with 409-conflict retry.
   * On a SHA conflict, refreshes the SHA from GitHub and retries once.
   */
  private async doWrite(path: string, data: unknown): Promise<void> {
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

    try {
      const newSha = await this.client.writeFile(path, content, sha);
      await this.cache.write(path, content, newSha);
    } catch (err) {
      if (err instanceof ShaConflictError) {
        // Retry once: refresh SHA from GitHub and write again
        const remote = await this.client.readFile(path);
        const freshSha = remote?.sha;
        const newSha = await this.client.writeFile(path, content, freshSha);
        await this.cache.write(path, content, newSha);
      } else {
        throw err;
      }
    }
  }

  /** Pull a single file from GitHub into the cache. */
  private async pullFile(path: string): Promise<void> {
    const remote = await this.client.readFile(path);
    if (remote) {
      await this.cache.write(path, remote.content, remote.sha);
    }
  }
}

/**
 * @deprecated Use `GitStateManager` instead. Retained as an alias for backward compatibility.
 */
export const StateManager = GitStateManager;
export type StateManager = GitStateManager;
