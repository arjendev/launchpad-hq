import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaemonToHqMessage, HqToDaemonMessage } from '../../../shared/protocol.js';

// ---------------------------------------------------------------------------
// Mock node-pty before importing the module under test
// ---------------------------------------------------------------------------

function createMockPty() {
  const pty = {
    onData: vi.fn((cb: (data: string) => void) => {
      pty._dataCallback = cb;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((cb: (e: { exitCode: number }) => void) => {
      pty._exitCallback = cb;
      return { dispose: vi.fn() };
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _dataCallback: null as ((data: string) => void) | null,
    _exitCallback: null as ((e: { exitCode: number }) => void) | null,
  };
  return pty;
}

let mockPty = createMockPty();

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPty),
}));

// Import after mock is set up
import { CliSessionManager } from '../manager.js';
import * as pty from 'node-pty';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup() {
  const sent: DaemonToHqMessage[] = [];
  const sendToHq = (msg: DaemonToHqMessage) => sent.push(msg);
  const manager = new CliSessionManager({
    sendToHq,
    projectId: 'test-project',
    cliPath: '/usr/bin/copilot',
    cwd: '/tmp',
  });
  return { sent, sendToHq, manager };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CliSessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPty = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(mockPty as any);
  });

  // -----------------------------------------------------------------------
  // createSession
  // -----------------------------------------------------------------------

  describe('createSession()', () => {
    it('returns a session ID and sends a session.start event', () => {
      const { sent, manager } = setup();
      const sessionId = manager.createSession('req-1');

      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe('string');

      // Should have sent exactly one message: copilot-session-event with session.start
      const startEvents = sent.filter(
        (m) =>
          m.type === 'copilot-session-event' &&
          (m.payload as any).event.type === 'session.start',
      );
      expect(startEvents).toHaveLength(1);

      const evt = startEvents[0] as any;
      expect(evt.payload.sessionId).toBe(sessionId);
      expect(evt.payload.sessionType).toBe('copilot-cli');
      expect(evt.payload.event.data.requestId).toBe('req-1');
    });

    it('spawns a PTY with the configured path and cwd', async () => {
      const ptyMod = vi.mocked(await import('node-pty'));
      const { manager } = setup();
      manager.createSession('req-2');

      expect(ptyMod.spawn).toHaveBeenCalledWith(
        '/usr/bin/copilot',
        [],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd: '/tmp',
        }),
      );
    });

    it('registers the session so hasSession returns true', () => {
      const { manager } = setup();
      const sessionId = manager.createSession('req-3');
      expect(manager.hasSession(sessionId)).toBe(true);
      expect(manager.hasSession('nonexistent')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // PTY data forwarding
  // -----------------------------------------------------------------------

  describe('PTY data forwarding', () => {
    it('sends terminal-data to HQ when attached', () => {
      const { sent, manager } = setup();
      const sessionId = manager.createSession('req-a');
      // Sessions start detached — resume to attach before sending data
      manager.resumeSession(sessionId);
      sent.length = 0; // clear the session.start event and any buffered replay

      // Simulate PTY output
      mockPty._dataCallback!('hello world');

      const dataMessages = sent.filter((m) => m.type === 'terminal-data');
      expect(dataMessages).toHaveLength(1);
      expect((dataMessages[0] as any).payload.sessionId).toBe(sessionId);
      expect((dataMessages[0] as any).payload.data).toBe('hello world');
    });

    it('buffers output when detached', () => {
      const { sent, manager } = setup();
      const sessionId = manager.createSession('req-b');
      manager.detachSession(sessionId);
      sent.length = 0;

      mockPty._dataCallback!('buffered data');

      // No terminal-data messages should be sent while detached
      expect(sent.filter((m) => m.type === 'terminal-data')).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // resumeSession
  // -----------------------------------------------------------------------

  describe('resumeSession()', () => {
    it('replays buffered output on resume', () => {
      const { sent, manager } = setup();
      const sessionId = manager.createSession('req-c');
      manager.detachSession(sessionId);
      sent.length = 0;

      // Simulate buffered output while detached
      mockPty._dataCallback!('chunk1');
      mockPty._dataCallback!('chunk2');

      // Resume
      const result = manager.resumeSession(sessionId);
      expect(result).toBe(true);

      const dataMessages = sent.filter((m) => m.type === 'terminal-data');
      expect(dataMessages).toHaveLength(1);
      expect((dataMessages[0] as any).payload.data).toBe('chunk1chunk2');
    });

    it('returns false for unknown session', () => {
      const { manager } = setup();
      expect(manager.resumeSession('no-such-session')).toBe(false);
    });

    it('forwards live data after resume', () => {
      const { sent, manager } = setup();
      const sessionId = manager.createSession('req-d');
      manager.detachSession(sessionId);
      manager.resumeSession(sessionId);
      sent.length = 0;

      mockPty._dataCallback!('live data');

      const dataMessages = sent.filter((m) => m.type === 'terminal-data');
      expect(dataMessages).toHaveLength(1);
      expect((dataMessages[0] as any).payload.data).toBe('live data');
    });
  });

  // -----------------------------------------------------------------------
  // detachSession
  // -----------------------------------------------------------------------

  describe('detachSession()', () => {
    it('returns true for known session', () => {
      const { manager } = setup();
      const sessionId = manager.createSession('req-e');
      expect(manager.detachSession(sessionId)).toBe(true);
    });

    it('returns false for unknown session', () => {
      const { manager } = setup();
      expect(manager.detachSession('nope')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // handleInput
  // -----------------------------------------------------------------------

  describe('handleInput()', () => {
    it('writes data to the PTY', () => {
      const { manager } = setup();
      const sessionId = manager.createSession('req-f');

      manager.handleInput(sessionId, 'user input');
      expect(mockPty.write).toHaveBeenCalledWith('user input');
    });

    it('does nothing for unknown session', () => {
      const { manager } = setup();
      manager.handleInput('unknown', 'data');
      expect(mockPty.write).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // handleResize
  // -----------------------------------------------------------------------

  describe('handleResize()', () => {
    it('resizes the PTY', () => {
      const { manager } = setup();
      const sessionId = manager.createSession('req-g');

      manager.handleResize(sessionId, 80, 24);
      expect(mockPty.resize).toHaveBeenCalledWith(80, 24);
    });
  });

  // -----------------------------------------------------------------------
  // endSession
  // -----------------------------------------------------------------------

  describe('endSession()', () => {
    it('kills the PTY process', () => {
      const { manager } = setup();
      const sessionId = manager.createSession('req-h');

      const result = manager.endSession(sessionId);
      expect(result).toBe(true);
      expect(mockPty.kill).toHaveBeenCalled();
    });

    it('returns false for unknown session', () => {
      const { manager } = setup();
      expect(manager.endSession('nope')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // PTY exit handling
  // -----------------------------------------------------------------------

  describe('PTY exit', () => {
    it('sends terminal-exit and session.shutdown events, then removes session', () => {
      const { sent, manager } = setup();
      const sessionId = manager.createSession('req-i');
      sent.length = 0;

      // Simulate PTY exit
      mockPty._exitCallback!({ exitCode: 0 });

      const exitMessages = sent.filter((m) => m.type === 'terminal-exit');
      expect(exitMessages).toHaveLength(1);
      expect((exitMessages[0] as any).payload.terminalId).toBe(sessionId);
      expect((exitMessages[0] as any).payload.exitCode).toBe(0);

      const shutdownEvents = sent.filter(
        (m) =>
          m.type === 'copilot-session-event' &&
          (m.payload as any).event.type === 'session.shutdown',
      );
      expect(shutdownEvents).toHaveLength(1);
      expect((shutdownEvents[0] as any).payload.sessionType).toBe(
        'copilot-cli',
      );

      // Session should be removed
      expect(manager.hasSession(sessionId)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // listSessions
  // -----------------------------------------------------------------------

  describe('listSessions()', () => {
    it('returns metadata for all active sessions', () => {
      const { manager } = setup();
      const id1 = manager.createSession('req-j');
      const id2 = manager.createSession('req-k');

      const list = manager.listSessions();
      expect(list).toHaveLength(2);

      const ids = list.map((s) => s.sessionId);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);

      for (const s of list) {
        expect(s.sessionType).toBe('copilot-cli');
        expect(s.status).toBe('idle');
        expect(s.summary).toBe('Copilot CLI terminal');
        expect(typeof s.startedAt).toBe('number');
        expect(typeof s.updatedAt).toBe('number');
      }
    });

    it('returns empty array when no sessions', () => {
      const { manager } = setup();
      expect(manager.listSessions()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // handleMessage routing
  // -----------------------------------------------------------------------

  describe('handleMessage()', () => {
    it('handles copilot-create-session with sessionType copilot-cli', async () => {
      const { manager } = setup();
      const result = await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-m', sessionType: 'copilot-cli' },
      });
      expect(result).toBe(true);
      expect(manager.listSessions()).toHaveLength(1);
    });

    it('ignores copilot-create-session with sessionType copilot-sdk', async () => {
      const { manager } = setup();
      const result = await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-n', sessionType: 'copilot-sdk' },
      });
      expect(result).toBe(false);
      expect(manager.listSessions()).toHaveLength(0);
    });

    it('handles terminal-input for a known session', async () => {
      const { manager } = setup();
      const sessionId = manager.createSession('req-o');

      const result = await manager.handleMessage({
        type: 'terminal-input',
        timestamp: Date.now(),
        payload: { projectId: 'test-project', sessionId, data: 'hello' },
      });
      expect(result).toBe(true);
      expect(mockPty.write).toHaveBeenCalledWith('hello');
    });

    it('returns false for terminal-input with unknown session', async () => {
      const { manager } = setup();
      const result = await manager.handleMessage({
        type: 'terminal-input',
        timestamp: Date.now(),
        payload: { projectId: 'test-project', sessionId: 'unknown', data: 'x' },
      });
      expect(result).toBe(false);
    });

    it('handles terminal-resize for a known session', async () => {
      const { manager } = setup();
      const sessionId = manager.createSession('req-p');

      const result = await manager.handleMessage({
        type: 'terminal-resize',
        timestamp: Date.now(),
        payload: { projectId: 'test-project', terminalId: sessionId, cols: 80, rows: 24 },
      });
      expect(result).toBe(true);
      expect(mockPty.resize).toHaveBeenCalledWith(80, 24);
    });

    it('handles copilot-resume-session for a known session', async () => {
      const { manager } = setup();
      const sessionId = manager.createSession('req-q');

      const result = await manager.handleMessage({
        type: 'copilot-resume-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-r', sessionId },
      });
      expect(result).toBe(true);
    });

    it('handles copilot-disconnect-session for a known session', async () => {
      const { manager } = setup();
      const sessionId = manager.createSession('req-s');

      const result = await manager.handleMessage({
        type: 'copilot-disconnect-session',
        timestamp: Date.now(),
        payload: { sessionId },
      });
      expect(result).toBe(true);
    });

    it('handles copilot-delete-session for a known session', async () => {
      const { manager } = setup();
      const sessionId = manager.createSession('req-t');

      const result = await manager.handleMessage({
        type: 'copilot-delete-session',
        timestamp: Date.now(),
        payload: { sessionId },
      });
      expect(result).toBe(true);
      expect(mockPty.kill).toHaveBeenCalled();
    });

    it('returns false for unrelated message types', async () => {
      const { manager } = setup();
      const result = await manager.handleMessage({
        type: 'request-status',
        timestamp: Date.now(),
        payload: { projectId: 'test-project' },
      } as HqToDaemonMessage);
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Ring buffer behaviour
  // -----------------------------------------------------------------------

  describe('ring buffer', () => {
    it('replays full output history including pre-detach data on resume', () => {
      const { sent, manager } = setup();
      const sessionId = manager.createSession('req-rb1');

      // Session starts detached. Send initial output (goes to ring buffer).
      mockPty._dataCallback!('initial-prompt$ ');

      // Attach (first resume) — replays initial output
      manager.resumeSession(sessionId);
      sent.length = 0;

      // Live output while attached (also stored in ring buffer)
      mockPty._dataCallback!('hello');
      mockPty._dataCallback!(' world');
      sent.length = 0;

      // Detach
      manager.detachSession(sessionId);

      // Output while detached (ring buffer only)
      mockPty._dataCallback!(' detached-data');

      // Second resume — should replay ALL output (pre + post detach)
      manager.resumeSession(sessionId);

      const replays = sent.filter((m) => m.type === 'terminal-data');
      expect(replays).toHaveLength(1);
      expect((replays[0] as any).payload.data).toBe(
        'initial-prompt$ hello world detached-data',
      );
    });

    it('evicts oldest chunks when exceeding 512 KB', () => {
      const { sent, manager } = setup();
      const sessionId = manager.createSession('req-rb2');

      // Push ~600 KB of data (each chunk is 10 KB)
      const chunkSize = 10 * 1024;
      const chunkCount = 60;
      for (let i = 0; i < chunkCount; i++) {
        mockPty._dataCallback!(String(i).padStart(5, '0') + 'X'.repeat(chunkSize - 5));
      }

      // Resume to see what was retained
      manager.resumeSession(sessionId);

      const replays = sent.filter((m) => m.type === 'terminal-data');
      expect(replays).toHaveLength(1);

      const replayed = (replays[0] as any).payload.data as string;

      // Should be capped near 512 KB — oldest chunks evicted
      expect(replayed.length).toBeLessThanOrEqual(512 * 1024 + chunkSize);
      // Should contain the latest chunk
      expect(replayed).toContain(String(chunkCount - 1).padStart(5, '0'));
      // Should NOT contain the very first chunk (evicted)
      expect(replayed).not.toContain('00000X');
    });

    it('preserves ring buffer across multiple resume/detach cycles', () => {
      const { sent, manager } = setup();
      const sessionId = manager.createSession('req-rb3');

      mockPty._dataCallback!('cycle0');
      manager.resumeSession(sessionId);

      mockPty._dataCallback!('-cycle1');
      manager.detachSession(sessionId);

      mockPty._dataCallback!('-cycle2');
      manager.resumeSession(sessionId);

      mockPty._dataCallback!('-cycle3');
      manager.detachSession(sessionId);

      // Clear everything before final resume so we only see the replay
      sent.length = 0;
      manager.resumeSession(sessionId);

      const replays = sent.filter((m) => m.type === 'terminal-data');
      expect(replays).toHaveLength(1);
      expect((replays[0] as any).payload.data).toBe(
        'cycle0-cycle1-cycle2-cycle3',
      );
    });

    it('sends live data AND stores in ring buffer when attached', () => {
      const { sent, manager } = setup();
      const sessionId = manager.createSession('req-rb4');
      manager.resumeSession(sessionId);
      sent.length = 0;

      // While attached, data should be sent live
      mockPty._dataCallback!('live-1');
      mockPty._dataCallback!('live-2');

      const liveMessages = sent.filter((m) => m.type === 'terminal-data');
      expect(liveMessages).toHaveLength(2);

      // Detach and resume — ring buffer should replay everything
      manager.detachSession(sessionId);
      sent.length = 0;
      manager.resumeSession(sessionId);

      const replays = sent.filter((m) => m.type === 'terminal-data');
      expect(replays).toHaveLength(1);
      // Contains live-1 and live-2 even though they were sent live earlier
      expect((replays[0] as any).payload.data).toContain('live-1');
      expect((replays[0] as any).payload.data).toContain('live-2');
    });
  });

  // -----------------------------------------------------------------------
  // stop
  // -----------------------------------------------------------------------

  describe('stop()', () => {
    it('kills all PTY processes and clears sessions', async () => {
      const { manager } = setup();
      const id1 = manager.createSession('req-u');
      manager.createSession('req-v');

      await manager.stop();

      expect(manager.listSessions()).toHaveLength(0);
      expect(manager.hasSession(id1)).toBe(false);
    });
  });
});
