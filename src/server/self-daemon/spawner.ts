/**
 * Self-daemon spawner — forks a child Node.js process running the daemon
 * entry point, so HQ can manage its own daemon using the exact same code
 * path as any remote daemon.
 */

import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { FastifyBaseLogger } from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolved path to the daemon entry module.
 *  Detect built dist/ context by checking if __dirname contains /dist/,
 *  rather than relying on NODE_ENV which may not be set in npx installs. */
const isBuilt =
  __dirname.includes("/dist/") || __dirname.includes("\\dist\\");
const DAEMON_ENTRY = isBuilt
  ? resolve(__dirname, "..", "..", "daemon", "index.js")
  : resolve(__dirname, "..", "..", "daemon", "index.ts");

export interface SelfDaemonConfig {
  hqUrl: string;
  token: string;
  projectId: string;
  enabled: boolean;
}

export interface SelfDaemonSpawnerOptions {
  config: SelfDaemonConfig;
  logger?: FastifyBaseLogger;
  /** Override the daemon entry path (useful for tests) */
  entryPath?: string;
  /** Enable auto-restart on unexpected exit (default: true) */
  autoRestart?: boolean;
  /** Maximum auto-restart attempts before giving up (default: 5) */
  maxRestarts?: number;
  /** Base delay between restart attempts in ms (default: 1000) */
  restartDelayMs?: number;
}

export class SelfDaemonSpawner {
  private childProcess: ChildProcess | null = null;
  private running = false;
  private stopping = false;
  private restartCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  readonly config: SelfDaemonConfig;
  private readonly logger?: FastifyBaseLogger;
  private readonly entryPath: string;
  private readonly autoRestart: boolean;
  private readonly maxRestarts: number;
  private readonly restartDelayMs: number;

  constructor(options: SelfDaemonSpawnerOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.entryPath = options.entryPath ?? DAEMON_ENTRY;
    this.autoRestart = options.autoRestart ?? true;
    this.maxRestarts = options.maxRestarts ?? 5;
    this.restartDelayMs = options.restartDelayMs ?? 1_000;
  }

  /** Spawn the daemon as a child process. */
  async start(): Promise<void> {
    if (this.running) return;

    if (!this.config.enabled) {
      this.logger?.info("Self-daemon disabled — skipping start");
      return;
    }

    this.stopping = false;
    this.spawn();
  }

  /** Stop the daemon gracefully (SIGTERM, then SIGKILL after timeout). */
  async stop(): Promise<void> {
    this.stopping = true;
    this.clearRestartTimer();

    if (!this.childProcess) {
      this.running = false;
      return;
    }

    return new Promise<void>((resolve) => {
      const cp = this.childProcess!;
      const killTimeout = setTimeout(() => {
        cp.kill("SIGKILL");
      }, 5_000);

      cp.once("exit", () => {
        clearTimeout(killTimeout);
        this.childProcess = null;
        this.running = false;
        resolve();
      });

      cp.kill("SIGTERM");
    });
  }

  /** Check if daemon is running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Get child process PID. */
  getPid(): number | null {
    return this.childProcess?.pid ?? null;
  }

  /** Get status summary for the REST API. */
  getStatus(): SelfDaemonStatus {
    return {
      running: this.running,
      pid: this.getPid(),
      projectId: this.config.projectId,
      enabled: this.config.enabled,
      restartCount: this.restartCount,
    };
  }

  // ── internals ──────────────────────────────────────────

  private spawn(): void {
    const execArgv = this.entryPath.endsWith(".ts")
      ? ["--import", "tsx"]
      : [];
    execArgv.push("--no-warnings=ExperimentalWarning");

    const child = fork(this.entryPath, [], {
      env: {
        ...process.env,
        LAUNCHPAD_HQ_URL: this.config.hqUrl,
        LAUNCHPAD_DAEMON_TOKEN: this.config.token,
        LAUNCHPAD_PROJECT_ID: this.config.projectId,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv,
    });

    this.childProcess = child;
    this.running = true;

    // Ensure the child is killed if the parent exits unexpectedly
    const killOnExit = () => {
      if (child.pid && !child.killed) {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }
    };
    process.once("exit", killOnExit);
    child.once("exit", () => process.removeListener("exit", killOnExit));

    child.stdout?.on("data", (data: Buffer) => {
      this.logger?.info({ source: "self-daemon" }, data.toString().trimEnd());
    });

    child.stderr?.on("data", (data: Buffer) => {
      this.logger?.warn({ source: "self-daemon" }, data.toString().trimEnd());
    });

    child.on("error", (err) => {
      this.logger?.error({ err }, "Self-daemon process error");
    });

    child.on("exit", (code, signal) => {
      this.running = false;
      this.childProcess = null;

      if (this.stopping) {
        this.logger?.info("Self-daemon stopped");
        return;
      }

      // Exit code 78 (EX_CONFIG) = auth failure — do not restart
      if (code === 78) {
        this.logger?.error(
          "Self-daemon auth failed — not restarting. Check daemon token.",
        );
        return;
      }

      this.logger?.warn(
        { code, signal },
        "Self-daemon exited unexpectedly",
      );

      if (this.autoRestart && this.restartCount < this.maxRestarts) {
        const delay = this.restartDelayMs * Math.pow(2, this.restartCount);
        this.restartCount++;
        this.logger?.info(
          { attempt: this.restartCount, delayMs: delay },
          "Scheduling self-daemon restart",
        );
        this.restartTimer = setTimeout(() => this.spawn(), delay);
      }
    });

    this.logger?.info(
      { pid: child.pid, projectId: this.config.projectId },
      "Self-daemon started",
    );
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}

export interface SelfDaemonStatus {
  running: boolean;
  pid: number | null;
  projectId: string;
  enabled: boolean;
  restartCount: number;
}

// ── helpers ──────────────────────────────────────────────

/**
 * Detect the current repository's project ID from git remote origin.
 * Falls back to the basename of the current working directory.
 */
export function detectProjectId(): string {
  try {
    const url = execSync("git remote get-url origin", {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return parseGitRemoteUrl(url);
  } catch {
    return process.cwd().split("/").pop() ?? "unknown";
  }
}

/** Parse a git remote URL to owner/repo. */
export function parseGitRemoteUrl(url: string): string {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+\/[^/.]+)/);
  if (httpsMatch) return httpsMatch[1];

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com:([^/]+\/[^/.]+)/);
  if (sshMatch) return sshMatch[1];

  // Fallback: last two path components
  const parts = url.replace(/\.git$/, "").split(/[/:]/);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }

  return process.cwd().split("/").pop() ?? "unknown";
}
