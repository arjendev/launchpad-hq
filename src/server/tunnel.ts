/**
 * TunnelManager — wraps the Microsoft `devtunnel` CLI to expose the local
 * Launchpad server to the internet for mobile/QR-code access.
 *
 * Lifecycle: stopped → starting → running → stopped
 * On crash:  running → error   (emits "error" event, then "status-change")
 *
 * Usage:
 *   const tm = getTunnelManager({ logger });
 *   await tm.start(3000);
 *   const url = tm.getShareUrl();   // hand this to the QR-code generator
 *   await tm.stop();
 */

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";

// ── Types ──────────────────────────────────────────────────

export interface TunnelInfo {
  url: string;
  tunnelId: string;
  port: number;
}

export type TunnelStatus = "stopped" | "starting" | "running" | "error";

export interface TunnelState {
  status: TunnelStatus;
  info: TunnelInfo | null;
  shareUrl: string | null;
  error: string | null;
}

export interface TunnelManagerOptions {
  logger?: FastifyBaseLogger;
  /** Startup timeout in ms (default 30 000) */
  startupTimeoutMs?: number;
  /** Override the CLI binary name (useful for tests) */
  cliBinary?: string;
}

// ── Errors ─────────────────────────────────────────────────

export class TunnelError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CLI_NOT_FOUND"
      | "STARTUP_TIMEOUT"
      | "PROCESS_ERROR",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TunnelError";
  }
}

// ── Events ─────────────────────────────────────────────────

export interface TunnelManagerEvents {
  "status-change": (state: TunnelState) => void;
  error: (err: TunnelError) => void;
}

// ── Manager ────────────────────────────────────────────────

export class TunnelManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: TunnelStatus = "stopped";
  private info: TunnelInfo | null = null;
  private lastError: string | null = null;
  private stopping = false;

  private readonly logger?: FastifyBaseLogger;
  private readonly startupTimeoutMs: number;
  private readonly cliBinary: string;

  constructor(options: TunnelManagerOptions = {}) {
    super();
    this.logger = options.logger;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
    this.cliBinary = options.cliBinary ?? "devtunnel";
  }

  // ── Public API ─────────────────────────────────────────

  /**
   * Check whether the `devtunnel` CLI is available on PATH.
   */
  async isCliAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(this.cliBinary, ["--version"], { timeout: 5_000 }, (err) => {
        resolve(!err);
      });
    });
  }

  /**
   * Start a dev tunnel hosting the given local port.
   * Resolves once the tunnel URL has been parsed from stdout.
   */
  async start(port: number): Promise<TunnelInfo> {
    if (this.status === "running" && this.info) {
      return this.info;
    }

    const cliReady = await this.isCliAvailable();
    if (!cliReady) {
      throw new TunnelError(
        "devtunnel CLI not found. Install it via: https://aka.ms/devtunnels/install",
        "CLI_NOT_FOUND",
      );
    }

    this.setStatus("starting");
    this.lastError = null;

    return new Promise<TunnelInfo>((resolve, reject) => {
      const child = spawn(
        this.cliBinary,
        ["host", "-p", String(port)],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      this.process = child;
      this.stopping = false;

      let stderrBuf = "";

      const timeout = setTimeout(() => {
        cleanup();
        const msg = stderrBuf
          ? `Tunnel failed to start within ${this.startupTimeoutMs}ms. stderr: ${stderrBuf}`
          : `Tunnel failed to start within ${this.startupTimeoutMs}ms`;
        const err = new TunnelError(msg, "STARTUP_TIMEOUT");
        this.handleError(err);
        reject(err);
        this.killProcess();
      }, this.startupTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        child.stdout?.removeListener("data", onStdout);
        child.stderr?.removeListener("data", onStderrStartup);
      };

      // devtunnel stdout contains a line like:
      //   Connect via browser: https://<id>-<port>.usw2.devtunnels.ms
      // or:  Hosting port: 3000 at https://<id>-<port>.usw2.devtunnels.ms
      // The tunnel ID is embedded in the subdomain.
      const urlPattern = /https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.devtunnels\.ms[^\s,;]*)/i;
      const tunnelIdPattern = /Tunnel ID:\s+([^\s]+)/i;

      let parsedUrl: string | null = null;
      let parsedTunnelId: string | null = null;

      const tryResolve = () => {
        if (!parsedUrl) return;

        // Derive tunnel ID from URL if we haven't seen a Tunnel ID line
        if (!parsedTunnelId) {
          const hostMatch = parsedUrl.match(/https?:\/\/([^.]+)/);
          parsedTunnelId = hostMatch ? hostMatch[1] : "unknown";
        }

        cleanup();

        const tunnelInfo: TunnelInfo = {
          url: parsedUrl,
          tunnelId: parsedTunnelId,
          port,
        };

        this.info = tunnelInfo;
        this.setStatus("running");
        this.logger?.info(
          { url: tunnelInfo.url, tunnelId: tunnelInfo.tunnelId, port },
          "Dev tunnel running",
        );
        resolve(tunnelInfo);
      };

      const onStdout = (data: Buffer) => {
        const line = data.toString();
        this.logger?.debug({ source: "devtunnel:stdout" }, line.trimEnd());

        const urlMatch = line.match(urlPattern);
        if (urlMatch && !parsedUrl) {
          parsedUrl = urlMatch[0];
        }

        const idMatch = line.match(tunnelIdPattern);
        if (idMatch) {
          parsedTunnelId = idMatch[1];
        }

        tryResolve();
      };

      const onStderrStartup = (data: Buffer) => {
        stderrBuf += data.toString();
      };

      child.stdout?.on("data", onStdout);
      child.stderr?.on("data", onStderrStartup);

      // After startup, keep piping stderr for logging
      child.stderr?.on("data", (data: Buffer) => {
        this.logger?.warn(
          { source: "devtunnel:stderr" },
          data.toString().trimEnd(),
        );
      });

      child.on("error", (err) => {
        cleanup();
        const tunnelErr = new TunnelError(
          `devtunnel process error: ${err.message}`,
          "PROCESS_ERROR",
          err,
        );
        this.handleError(tunnelErr);
        reject(tunnelErr);
      });

      child.on("exit", (code, signal) => {
        if (this.stopping) {
          this.logger?.info("Dev tunnel stopped");
          return;
        }

        cleanup();

        if (this.status === "starting") {
          // Never reached "running" — reject the start() promise
          const msg = `devtunnel exited during startup (code=${code}, signal=${signal}). stderr: ${stderrBuf}`;
          const err = new TunnelError(msg, "PROCESS_ERROR");
          this.handleError(err);
          reject(err);
        } else {
          // Was running, crashed unexpectedly
          const msg = `devtunnel exited unexpectedly (code=${code}, signal=${signal})`;
          this.logger?.error({ code, signal }, msg);
          this.handleError(new TunnelError(msg, "PROCESS_ERROR"));
        }

        this.process = null;
      });

      this.logger?.info(
        { pid: child.pid, port },
        "Spawned devtunnel host process",
      );
    });
  }

  /**
   * Stop the tunnel gracefully (SIGTERM, then SIGKILL after 5 s).
   */
  async stop(): Promise<void> {
    this.stopping = true;

    if (!this.process) {
      this.setStatus("stopped");
      this.info = null;
      return;
    }

    return new Promise<void>((resolve) => {
      const cp = this.process!;

      const killTimeout = setTimeout(() => {
        cp.kill("SIGKILL");
      }, 5_000);

      cp.once("exit", () => {
        clearTimeout(killTimeout);
        this.process = null;
        this.info = null;
        this.setStatus("stopped");
        resolve();
      });

      cp.kill("SIGTERM");
    });
  }

  /**
   * Current tunnel status.
   */
  getStatus(): TunnelStatus {
    return this.status;
  }

  /**
   * Full tunnel state snapshot (for API responses).
   */
  getState(): TunnelState {
    return {
      status: this.status,
      info: this.info,
      shareUrl: this.getShareUrl(),
      error: this.lastError,
    };
  }

  /**
   * Returns the tunnel URL suitable for QR code generation.
   * Returns null when tunnel is not running.
   */
  getShareUrl(): string | null {
    if (!this.info) return null;
    return this.info.url.replace(/\/$/, "");
  }

  // ── Internals ──────────────────────────────────────────

  private setStatus(next: TunnelStatus): void {
    if (next === this.status) return;
    this.status = next;
    this.emit("status-change", this.getState());
  }

  private handleError(err: TunnelError): void {
    this.lastError = err.message;
    this.setStatus("error");
    this.emit("error", err);
  }

  private killProcess(): void {
    if (this.process) {
      this.stopping = true;
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }
}

// ── Singleton factory ──────────────────────────────────────

let _instance: TunnelManager | null = null;

/**
 * Get (or create) the shared TunnelManager instance.
 * Romilly can import this from the Fastify plugin layer.
 */
export function getTunnelManager(
  options?: TunnelManagerOptions,
): TunnelManager {
  if (!_instance) {
    _instance = new TunnelManager(options);
  }
  return _instance;
}

/**
 * Reset the singleton (useful in tests).
 */
export function resetTunnelManager(): void {
  _instance = null;
}
