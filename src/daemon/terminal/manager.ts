/**
 * Daemon-side PTY session manager.
 *
 * Uses a dynamic import for node-pty so the
 * module is optional — if it isn't installed the manager can still be constructed
 * but spawn() will throw.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// PTY types (subset we use from node-pty)
interface IPty {
  onData: (handler: (data: string) => void) => { dispose: () => void };
  onExit: (handler: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void };
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
  pid: number;
}

interface NodePtyModule {
  spawn: (
    shell: string,
    args: string[],
    options: { name?: string; cols?: number; rows?: number; cwd?: string; env?: Record<string, string> },
  ) => IPty;
}

let nodePty: NodePtyModule | null = null;
let nodePtyLoaded = false;

async function loadNodePty(): Promise<NodePtyModule | null> {
  if (nodePtyLoaded) return nodePty;
  try {
    nodePty = (await import('node-pty')) as unknown as NodePtyModule;
  } catch {
    nodePty = null;
  }
  nodePtyLoaded = true;
  return nodePty;
}

/** Minimum PATH entries to guarantee core utilities are available. */
const FALLBACK_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

/**
 * Detect the current user's default shell from /etc/passwd.
 * Returns undefined if detection fails.
 */
function detectShellFromPasswd(): string | undefined {
  try {
    const line = execSync('getent passwd $(id -un)', { encoding: 'utf8', timeout: 2000 }).trim();
    const shell = line.split(':').pop();
    if (shell && existsSync(shell)) return shell;
  } catch {
    // Not available on all systems
  }
  return undefined;
}

/**
 * Build a sane shell environment by merging process.env with
 * guaranteed defaults. Critical when the daemon is backgrounded
 * (e.g. postStartCommand) where process.env is minimal.
 */
export function buildShellEnv(processEnv: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  // Copy existing env (strip undefined values)
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined) env[key] = value;
  }

  // TERM — always match the PTY name we pass to the pty module
  env['TERM'] = 'xterm-256color';

  // COLORTERM — enable truecolor support
  env['COLORTERM'] = 'truecolor';

  // SHELL — detect if missing
  if (!env['SHELL']) {
    env['SHELL'] = detectShellFromPasswd() ?? '/bin/bash';
  }

  // HOME — derive from user if missing
  if (!env['HOME']) {
    try {
      env['HOME'] = execSync('echo ~', { encoding: 'utf8', timeout: 2000 }).trim();
    } catch {
      env['HOME'] = process.platform === 'win32' ? (env['USERPROFILE'] ?? '') : `/home/${env['USER'] ?? 'root'}`;
    }
  }

  // PATH — ensure minimum entries are present
  if (!env['PATH']) {
    env['PATH'] = FALLBACK_PATH;
  } else if (!env['PATH'].includes('/usr/bin')) {
    env['PATH'] = `${env['PATH']}:${FALLBACK_PATH}`;
  }

  // LANG — prevent i18n issues in non-interactive shells
  if (!env['LANG']) {
    env['LANG'] = 'en_US.UTF-8';
  }

  return env;
}

export interface TerminalSession {
  pty: IPty;
  dataDisposable: { dispose: () => void };
  exitDisposable: { dispose: () => void };
}

export interface SpawnOptions {
  cols?: number;
  rows?: number;
  shell?: string;
}

export class DaemonTerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private dataHandlers = new Map<string, (data: string) => void>();
  private exitHandlers = new Map<string, (exitCode: number) => void>();

  /** Ensure pty module is loaded. Call once at startup. */
  async init(): Promise<boolean> {
    const mod = await loadNodePty();
    return mod !== null;
  }

  /** Spawn a new PTY shell session. */
  spawn(terminalId: string, options?: SpawnOptions): string {
    if (!nodePty) {
      throw new Error('PTY module is not available — terminal relay disabled');
    }

    if (this.sessions.has(terminalId)) {
      throw new Error(`Terminal session '${terminalId}' already exists`);
    }

    const shell = options?.shell ?? (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/sh');
    const cols = options?.cols ?? 80;
    const rows = options?.rows ?? 24;
    const env = buildShellEnv(process.env as Record<string, string | undefined>);

    let pty: IPty;
    try {
      pty = nodePty.spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.cwd(),
        env,
      });
      console.log(`[terminal] Spawned PTY session '${terminalId}': shell=${shell} pid=${pty.pid} cols=${cols} rows=${rows}`);
    } catch (err) {
      console.error(`[terminal] Failed to spawn PTY session '${terminalId}': shell=${shell}`, err);
      throw err;
    }

    const dataDisposable = pty.onData((data: string) => {
      const handler = this.dataHandlers.get(terminalId);
      if (handler) handler(data);
    });

    const exitDisposable = pty.onExit((e: { exitCode: number }) => {
      console.log(`[terminal] PTY session '${terminalId}' exited: code=${e.exitCode}`);
      const handler = this.exitHandlers.get(terminalId);
      if (handler) handler(e.exitCode);
      this.sessions.delete(terminalId);
      this.dataHandlers.delete(terminalId);
      this.exitHandlers.delete(terminalId);
    });

    this.sessions.set(terminalId, { pty, dataDisposable, exitDisposable });
    return terminalId;
  }

  /** Write input data to a PTY session. */
  write(terminalId: string, data: string): void {
    const session = this.sessions.get(terminalId);
    if (!session) throw new Error(`No terminal session '${terminalId}'`);
    session.pty.write(data);
  }

  /** Resize a PTY session. */
  resize(terminalId: string, cols: number, rows: number): void {
    const session = this.sessions.get(terminalId);
    if (!session) throw new Error(`No terminal session '${terminalId}'`);
    session.pty.resize(cols, rows);
  }

  /** Kill a PTY session. */
  kill(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (!session) return;
    session.dataDisposable.dispose();
    session.exitDisposable.dispose();
    session.pty.kill();
    this.sessions.delete(terminalId);
    this.dataHandlers.delete(terminalId);
    this.exitHandlers.delete(terminalId);
  }

  /** Kill all active PTY sessions (cleanup). */
  killAll(): void {
    for (const terminalId of [...this.sessions.keys()]) {
      this.kill(terminalId);
    }
  }

  /** Register a data output handler for a terminal session. */
  onData(terminalId: string, handler: (data: string) => void): void {
    this.dataHandlers.set(terminalId, handler);
  }

  /** Register an exit handler for a terminal session. */
  onExit(terminalId: string, handler: (exitCode: number) => void): void {
    this.exitHandlers.set(terminalId, handler);
  }

  /** Check if a terminal session exists. */
  has(terminalId: string): boolean {
    return this.sessions.has(terminalId);
  }

  /** List all active terminal session IDs. */
  listSessions(): string[] {
    return [...this.sessions.keys()];
  }
}
