/**
 * CliSessionManager — manages copilot-cli terminal sessions.
 *
 * Spawns the `copilot` CLI binary in a PTY. Each session is a running terminal
 * process. Users interact via the HQ UI (xterm.js). Sessions can be detached
 * (UI closed, process keeps running) and reattached (buffered output replayed).
 */
import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import type {
  DaemonToHqMessage,
  HqToDaemonMessage,
  SessionType,
} from '../../shared/protocol.js';
import { logSdk } from '../logger.js';

export type SendToHq = (msg: DaemonToHqMessage) => void;

/** Minimal PTY handle — the subset of node-pty's IPty we actually use */
interface PtyHandle {
  onData: (handler: (data: string) => void) => { dispose(): void };
  onExit: (handler: (e: { exitCode: number; signal?: number }) => void) => { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

/** Max ring-buffer size per session (bytes). Keeps enough ANSI data for
 *  xterm.js to reconstruct the current TUI screen on resume. */
const MAX_BUFFER_BYTES = 512 * 1024; // 512 KB

interface CliSession {
  id: string;
  ptyProcess: PtyHandle;
  /**
   * Ring buffer of ALL PTY output (both attached and detached periods).
   * On resume the entire buffer is replayed so xterm.js can reconstruct
   * the full screen state — critical for TUI apps like Copilot CLI that
   * continuously redraw.
   */
  ringBuffer: string[];
  /** Byte-length sum of ringBuffer entries. */
  ringBufferSize: number;
  /** Whether UI is currently viewing this session */
  attached: boolean;
  startedAt: number;
  updatedAt: number;
  summary: string;
}

export interface CliSessionManagerOptions {
  sendToHq: SendToHq;
  projectId?: string;
  /** Path to copilot binary, default 'copilot' */
  cliPath?: string;
  cwd?: string;
}

export class CliSessionManager {
  private sessions = new Map<string, CliSession>();
  private sendToHq: SendToHq;
  private projectId: string;
  private cliPath: string;
  private cwd: string;

  constructor(options: CliSessionManagerOptions) {
    this.sendToHq = options.sendToHq;
    this.projectId = options.projectId ?? 'unknown';
    this.cliPath = options.cliPath ?? 'copilot';
    this.cwd = options.cwd ?? process.cwd();
  }

  /** Create a new copilot-cli terminal session */
  createSession(requestId: string): string {
    const sessionId = randomUUID();
    const cols = 120;
    const rows = 40;

    const ptyProcess = pty.spawn(this.cliPath, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: this.cwd,
      env: process.env as Record<string, string>,
    });

    const session: CliSession = {
      id: sessionId,
      ptyProcess,
      ringBuffer: [],
      ringBufferSize: 0,
      attached: false,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      summary: 'Copilot CLI terminal',
    };

    // Wire PTY output → ring buffer (always) + HQ (when attached)
    ptyProcess.onData((data: string) => {
      session.updatedAt = Date.now();

      // Always append to ring buffer so resume can reconstruct full screen
      session.ringBuffer.push(data);
      session.ringBufferSize += data.length;

      // Evict oldest chunks while over budget
      while (session.ringBufferSize > MAX_BUFFER_BYTES && session.ringBuffer.length > 1) {
        const removed = session.ringBuffer.shift()!;
        session.ringBufferSize -= removed.length;
      }

      // Stream live when attached
      if (session.attached) {
        this.sendToHq({
          type: 'terminal-data',
          timestamp: Date.now(),
          payload: {
            projectId: this.projectId,
            sessionId,
            data,
          },
        });
      }
    });

    // Wire PTY exit → session ended
    ptyProcess.onExit(({ exitCode }) => {
      logSdk(`CLI session ${sessionId} exited with code ${exitCode}`);
      this.sendToHq({
        type: 'terminal-exit',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          terminalId: sessionId,
          exitCode,
        },
      });
      // Send a synthetic session event so the aggregator can mark it ended
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          sessionType: 'copilot-cli' as SessionType,
          event: {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            parentId: null,
            type: 'session.shutdown',
            data: { exitCode },
          } as any,
        },
      });
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);

    // Send a synthetic session.start event to HQ
    this.sendToHq({
      type: 'copilot-session-event',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId,
        sessionType: 'copilot-cli' as SessionType,
        event: {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          parentId: null,
          type: 'session.start',
          data: { requestId, sessionId, sessionType: 'copilot-cli' },
        } as any,
      },
    });

    return sessionId;
  }

  /** Resume (reattach to) an existing CLI session — replay ring buffer */
  resumeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.attached = true;
    session.updatedAt = Date.now();

    // Replay entire ring buffer so xterm.js can reconstruct full screen state.
    // For TUI apps (Copilot CLI) this replays the most recent ~512 KB of ANSI
    // output, which is enough for xterm to reach the current visual state.
    if (session.ringBuffer.length > 0) {
      const buffered = session.ringBuffer.join('');
      this.sendToHq({
        type: 'terminal-data',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          data: buffered,
        },
      });
    }

    return true;
  }

  /** Detach from a session (stop sending output to HQ, start buffering) */
  detachSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.attached = false;
    return true;
  }

  /** Send user input to a CLI session's PTY */
  handleInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ptyProcess.write(data);
      session.updatedAt = Date.now();
    }
  }

  /** Resize the PTY for a session */
  handleResize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  /** End a CLI session — kills the PTY process */
  endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.ptyProcess.kill();
    // onExit handler will clean up and notify HQ
    return true;
  }

  /** List all active CLI sessions as metadata for the unified session list */
  listSessions(): Array<{
    sessionId: string;
    sessionType: 'copilot-cli';
    status: string;
    summary: string;
    startedAt: number;
    updatedAt: number;
  }> {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.id,
      sessionType: 'copilot-cli' as const,
      status: 'idle',
      summary: s.summary,
      startedAt: s.startedAt,
      updatedAt: s.updatedAt,
    }));
  }

  /** Handle an incoming HQ message for CLI sessions. Returns true if handled. */
  async handleMessage(msg: HqToDaemonMessage): Promise<boolean> {
    switch (msg.type) {
      case 'copilot-create-session': {
        if (msg.payload.sessionType !== 'copilot-cli') return false;
        const sessionId = this.createSession(msg.payload.requestId);
        logSdk(`Created CLI session: ${sessionId}`);
        return true;
      }
      case 'copilot-resume-session': {
        if (!this.sessions.has(msg.payload.sessionId)) return false;
        this.resumeSession(msg.payload.sessionId);
        return true;
      }
      case 'terminal-input': {
        if (!this.sessions.has(msg.payload.sessionId)) return false;
        this.handleInput(msg.payload.sessionId, msg.payload.data);
        return true;
      }
      case 'terminal-resize': {
        if (!this.sessions.has(msg.payload.terminalId)) return false;
        this.handleResize(
          msg.payload.terminalId,
          msg.payload.cols,
          msg.payload.rows,
        );
        return true;
      }
      case 'copilot-disconnect-session': {
        if (!this.sessions.has(msg.payload.sessionId)) return false;
        this.detachSession(msg.payload.sessionId);
        return true;
      }
      case 'copilot-delete-session': {
        if (!this.sessions.has(msg.payload.sessionId)) return false;
        this.endSession(msg.payload.sessionId);
        return true;
      }
      default:
        return false;
    }
  }

  /** Check if a session ID belongs to this manager */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Shut down all sessions */
  async stop(): Promise<void> {
    for (const [, session] of this.sessions) {
      session.ptyProcess.kill();
    }
    this.sessions.clear();
  }
}
