/**
 * Daemon-side PTY session manager.
 *
 * Uses a dynamic import for node-pty so the module is optional —
 * if node-pty isn't installed the manager can still be constructed
 * but spawn() will throw.
 */

// node-pty types (subset we use)
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

  /** Ensure node-pty is loaded. Call once at startup. */
  async init(): Promise<boolean> {
    const mod = await loadNodePty();
    return mod !== null;
  }

  /** Spawn a new PTY shell session. */
  spawn(terminalId: string, options?: SpawnOptions): string {
    if (!nodePty) {
      throw new Error('node-pty is not available — terminal relay disabled');
    }

    if (this.sessions.has(terminalId)) {
      throw new Error(`Terminal session '${terminalId}' already exists`);
    }

    const shell = options?.shell ?? (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/sh');
    const cols = options?.cols ?? 80;
    const rows = options?.rows ?? 24;

    const pty = nodePty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });

    const dataDisposable = pty.onData((data: string) => {
      const handler = this.dataHandlers.get(terminalId);
      if (handler) handler(data);
    });

    const exitDisposable = pty.onExit((e: { exitCode: number }) => {
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
