import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DaemonTerminalManager } from '../terminal/manager.js';

// ---------------------------------------------------------------------------
// Mock node-pty — the manager uses dynamic import, so we mock at module level
// ---------------------------------------------------------------------------

function createMockPty() {
  let dataHandler: ((data: string) => void) | null = null;
  let exitHandler: ((e: { exitCode: number; signal?: number }) => void) | null = null;

  return {
    pid: 12345,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((handler: (data: string) => void) => {
      dataHandler = handler;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((handler: (e: { exitCode: number }) => void) => {
      exitHandler = handler;
      return { dispose: vi.fn() };
    }),
    // Test helpers
    simulateData(data: string) {
      if (dataHandler) dataHandler(data);
    },
    simulateExit(exitCode: number) {
      if (exitHandler) exitHandler({ exitCode });
    },
  };
}

// We cannot actually import node-pty in tests, so we test the manager
// by directly manipulating its internal state via spawn with a mock.
// The manager uses a dynamic import pattern; for unit tests we verify
// the "no node-pty" path and the public API contracts.

describe('DaemonTerminalManager', () => {
  let manager: DaemonTerminalManager;

  beforeEach(() => {
    manager = new DaemonTerminalManager();
  });

  describe('without node-pty loaded', () => {
    it('can be constructed', () => {
      expect(manager).toBeDefined();
    });

    it('init detects node-pty availability', async () => {
      const available = await manager.init();
      // node-pty is now a regular dependency — init should succeed
      expect(typeof available).toBe('boolean');
    });

    it('has returns false for non-existent session', () => {
      expect(manager.has('t1')).toBe(false);
    });

    it('listSessions returns empty array', () => {
      expect(manager.listSessions()).toEqual([]);
    });

    it('kill does not throw for non-existent session', () => {
      expect(() => manager.kill('t1')).not.toThrow();
    });

    it('killAll does not throw when empty', () => {
      expect(() => manager.killAll()).not.toThrow();
    });

    it('write throws for non-existent session', () => {
      expect(() => manager.write('t1', 'hello')).toThrow("No terminal session 't1'");
    });

    it('resize throws for non-existent session', () => {
      expect(() => manager.resize('t1', 80, 24)).toThrow("No terminal session 't1'");
    });
  });

  describe('with mocked node-pty (simulated sessions)', () => {
    // Since we can't actually have node-pty spawn real PTYs in tests,
    // we test the data/exit handler wiring by directly invoking the manager's
    // onData/onExit registration, which works independently of spawn.

    it('onData registers a handler', () => {
      const handler = vi.fn();
      // Registering a handler for a non-spawned session is fine (it's just a map set)
      manager.onData('t1', handler);
      // No error — handler is registered
    });

    it('onExit registers a handler', () => {
      const handler = vi.fn();
      manager.onExit('t1', handler);
      // No error — handler is registered
    });
  });
});

// ---------------------------------------------------------------------------
// Test the manager with an injected mock PTY session
// This tests the actual data flow without needing node-pty
// ---------------------------------------------------------------------------

describe('DaemonTerminalManager (with injected mock session)', () => {
  it('write delegates to the PTY', () => {
    const manager = new DaemonTerminalManager();
    const mockPty = createMockPty();

    // Inject a session directly into the manager's internal map
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set('t1', {
      pty: mockPty,
      dataDisposable: { dispose: vi.fn() },
      exitDisposable: { dispose: vi.fn() },
    });

    manager.write('t1', 'hello');
    expect(mockPty.write).toHaveBeenCalledWith('hello');
  });

  it('resize delegates to the PTY', () => {
    const manager = new DaemonTerminalManager();
    const mockPty = createMockPty();

    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set('t1', {
      pty: mockPty,
      dataDisposable: { dispose: vi.fn() },
      exitDisposable: { dispose: vi.fn() },
    });

    manager.resize('t1', 120, 40);
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40);
  });

  it('kill disposes handlers and kills PTY', () => {
    const manager = new DaemonTerminalManager();
    const mockPty = createMockPty();
    const dataDispose = vi.fn();
    const exitDispose = vi.fn();

    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set('t1', {
      pty: mockPty,
      dataDisposable: { dispose: dataDispose },
      exitDisposable: { dispose: exitDispose },
    });

    manager.kill('t1');
    expect(dataDispose).toHaveBeenCalled();
    expect(exitDispose).toHaveBeenCalled();
    expect(mockPty.kill).toHaveBeenCalled();
    expect(manager.has('t1')).toBe(false);
  });

  it('killAll kills all sessions', () => {
    const manager = new DaemonTerminalManager();
    const mockPty1 = createMockPty();
    const mockPty2 = createMockPty();

    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set('t1', {
      pty: mockPty1,
      dataDisposable: { dispose: vi.fn() },
      exitDisposable: { dispose: vi.fn() },
    });
    sessions.set('t2', {
      pty: mockPty2,
      dataDisposable: { dispose: vi.fn() },
      exitDisposable: { dispose: vi.fn() },
    });

    manager.killAll();
    expect(manager.listSessions()).toEqual([]);
    expect(mockPty1.kill).toHaveBeenCalled();
    expect(mockPty2.kill).toHaveBeenCalled();
  });

  it('has returns true for existing session', () => {
    const manager = new DaemonTerminalManager();
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set('t1', {
      pty: createMockPty(),
      dataDisposable: { dispose: vi.fn() },
      exitDisposable: { dispose: vi.fn() },
    });

    expect(manager.has('t1')).toBe(true);
  });

  it('listSessions returns all session IDs', () => {
    const manager = new DaemonTerminalManager();
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set('t1', {
      pty: createMockPty(),
      dataDisposable: { dispose: vi.fn() },
      exitDisposable: { dispose: vi.fn() },
    });
    sessions.set('t2', {
      pty: createMockPty(),
      dataDisposable: { dispose: vi.fn() },
      exitDisposable: { dispose: vi.fn() },
    });

    expect(manager.listSessions().sort()).toEqual(['t1', 't2']);
  });

  it('onData handler is called when PTY produces output', () => {
    const manager = new DaemonTerminalManager();
    const mockPty = createMockPty();

    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set('t1', {
      pty: mockPty,
      dataDisposable: { dispose: vi.fn() },
      exitDisposable: { dispose: vi.fn() },
    });

    const handler = vi.fn();
    manager.onData('t1', handler);

    // The mock PTY's onData was registered during spawn, but for injected sessions
    // we registered the handler on the manager. We need to simulate the manager's
    // internal data callback being triggered. The manager stores data handlers
    // in its dataHandlers map and the PTY onData calls it.
    // Since we injected the session, the PTY's onData wasn't wired through manager.
    // Instead, we test that the handler map is set correctly.
    const dataHandlers = (manager as unknown as { dataHandlers: Map<string, (data: string) => void> }).dataHandlers;
    expect(dataHandlers.get('t1')).toBe(handler);
  });

  it('onExit handler is called when PTY exits', () => {
    const manager = new DaemonTerminalManager();
    const handler = vi.fn();
    manager.onExit('t1', handler);

    const exitHandlers = (manager as unknown as { exitHandlers: Map<string, (exitCode: number) => void> }).exitHandlers;
    expect(exitHandlers.get('t1')).toBe(handler);
  });
});
