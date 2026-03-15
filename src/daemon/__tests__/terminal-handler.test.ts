import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { setupDaemonTerminal } from '../terminal/index.js';
import { DaemonTerminalManager } from '../terminal/manager.js';
import type { HqToDaemonMessage } from '../../shared/protocol.js';

// ---------------------------------------------------------------------------
// Mock DaemonWebSocketClient — just needs 'message' event + send()
// ---------------------------------------------------------------------------

class MockClient extends EventEmitter {
  sent: unknown[] = [];

  send(msg: unknown) {
    this.sent.push(msg);
  }

  get isAuthenticated() {
    return true;
  }

  get isConnected() {
    return true;
  }
}

// Mock DaemonTerminalManager that doesn't need the pty module
class MockTerminalManager extends DaemonTerminalManager {
  spawnCalls: Array<{ terminalId: string; options?: { cols?: number; rows?: number; shell?: string } }> = [];
  writeCalls: Array<{ terminalId: string; data: string }> = [];
  resizeCalls: Array<{ terminalId: string; cols: number; rows: number }> = [];
  killCalls: string[] = [];
  killAllCalled = false;

  override spawn(terminalId: string, options?: { cols?: number; rows?: number; shell?: string }): string {
    this.spawnCalls.push({ terminalId, options });
    // Inject a mock session so has() returns true
    const sessions = (this as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set(terminalId, {
      pty: { write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })), onExit: vi.fn(() => ({ dispose: vi.fn() })) },
      dataDisposable: { dispose: vi.fn() },
      exitDisposable: { dispose: vi.fn() },
    });
    return terminalId;
  }

  override write(terminalId: string, data: string): void {
    this.writeCalls.push({ terminalId, data });
  }

  override resize(terminalId: string, cols: number, rows: number): void {
    this.resizeCalls.push({ terminalId, cols, rows });
  }

  override kill(terminalId: string): void {
    this.killCalls.push(terminalId);
    const sessions = (this as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.delete(terminalId);
  }

  override killAll(): void {
    this.killAllCalled = true;
    const sessions = (this as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.clear();
  }
}

describe('setupDaemonTerminal', () => {
  let client: MockClient;
  let manager: MockTerminalManager;

  beforeEach(() => {
    client = new MockClient();
    manager = new MockTerminalManager();
  });

  it('returns manager and cleanup function', () => {
    const result = setupDaemonTerminal({
      client: client as never,
      projectId: 'proj-1',
      manager,
    });
    expect(result.manager).toBe(manager);
    expect(typeof result.cleanup).toBe('function');
  });

  it('handles terminal-spawn messages', () => {
    setupDaemonTerminal({
      client: client as never,
      projectId: 'proj-1',
      manager,
    });

    const msg: HqToDaemonMessage = {
      type: 'terminal-spawn',
      timestamp: Date.now(),
      payload: { projectId: 'proj-1', terminalId: 't1', cols: 120, rows: 40 },
    };
    client.emit('message', msg);

    expect(manager.spawnCalls).toHaveLength(1);
    expect(manager.spawnCalls[0].terminalId).toBe('t1');
    expect(manager.spawnCalls[0].options).toEqual({ cols: 120, rows: 40 });
  });

  it('handles terminal-input messages', () => {
    setupDaemonTerminal({
      client: client as never,
      projectId: 'proj-1',
      manager,
    });

    // Spawn first so the session exists
    client.emit('message', {
      type: 'terminal-spawn',
      timestamp: Date.now(),
      payload: { projectId: 'proj-1', terminalId: 't1' },
    });

    const msg: HqToDaemonMessage = {
      type: 'terminal-input',
      timestamp: Date.now(),
      payload: { projectId: 'proj-1', sessionId: 't1', data: 'ls\n' },
    };
    client.emit('message', msg);

    expect(manager.writeCalls).toHaveLength(1);
    expect(manager.writeCalls[0]).toEqual({ terminalId: 't1', data: 'ls\n' });
  });

  it('handles terminal-resize messages', () => {
    setupDaemonTerminal({
      client: client as never,
      projectId: 'proj-1',
      manager,
    });

    const msg: HqToDaemonMessage = {
      type: 'terminal-resize',
      timestamp: Date.now(),
      payload: { projectId: 'proj-1', terminalId: 't1', cols: 200, rows: 50 },
    };
    client.emit('message', msg);

    expect(manager.resizeCalls).toHaveLength(1);
    expect(manager.resizeCalls[0]).toEqual({ terminalId: 't1', cols: 200, rows: 50 });
  });

  it('handles terminal-kill messages', () => {
    setupDaemonTerminal({
      client: client as never,
      projectId: 'proj-1',
      manager,
    });

    const msg: HqToDaemonMessage = {
      type: 'terminal-kill',
      timestamp: Date.now(),
      payload: { projectId: 'proj-1', terminalId: 't1' },
    };
    client.emit('message', msg);

    expect(manager.killCalls).toEqual(['t1']);
  });

  it('wires data handler after spawn to send terminal-data to HQ', () => {
    setupDaemonTerminal({
      client: client as never,
      projectId: 'proj-1',
      manager,
    });

    // Spawn terminal
    client.emit('message', {
      type: 'terminal-spawn',
      timestamp: Date.now(),
      payload: { projectId: 'proj-1', terminalId: 't1' },
    });

    // The handler should have registered onData for 't1'
    const dataHandlers = (manager as unknown as { dataHandlers: Map<string, (data: string) => void> }).dataHandlers;
    const handler = dataHandlers.get('t1');
    expect(handler).toBeDefined();

    // Simulate PTY output
    handler!('hello world');

    // Should have sent terminal-data to HQ
    expect(client.sent).toHaveLength(1);
    const sentMsg = client.sent[0] as { type: string; payload: { projectId: string; sessionId: string; data: string } };
    expect(sentMsg.type).toBe('terminal-data');
    expect(sentMsg.payload.projectId).toBe('proj-1');
    expect(sentMsg.payload.sessionId).toBe('t1');
    expect(sentMsg.payload.data).toBe('hello world');
  });

  it('wires exit handler after spawn to send terminal-exit to HQ', () => {
    setupDaemonTerminal({
      client: client as never,
      projectId: 'proj-1',
      manager,
    });

    // Spawn terminal
    client.emit('message', {
      type: 'terminal-spawn',
      timestamp: Date.now(),
      payload: { projectId: 'proj-1', terminalId: 't1' },
    });

    // The handler should have registered onExit for 't1'
    const exitHandlers = (manager as unknown as { exitHandlers: Map<string, (exitCode: number) => void> }).exitHandlers;
    const handler = exitHandlers.get('t1');
    expect(handler).toBeDefined();

    // Simulate PTY exit
    handler!(42);

    // Should have sent terminal-exit to HQ
    expect(client.sent).toHaveLength(1);
    const sentMsg = client.sent[0] as { type: string; payload: { projectId: string; terminalId: string; exitCode: number } };
    expect(sentMsg.type).toBe('terminal-exit');
    expect(sentMsg.payload.projectId).toBe('proj-1');
    expect(sentMsg.payload.terminalId).toBe('t1');
    expect(sentMsg.payload.exitCode).toBe(42);
  });

  it('cleanup kills all terminals and removes listener', () => {
    const { cleanup } = setupDaemonTerminal({
      client: client as never,
      projectId: 'proj-1',
      manager,
    });

    cleanup();
    expect(manager.killAllCalled).toBe(true);

    // Messages after cleanup should not reach the manager
    manager.spawnCalls = [];
    client.emit('message', {
      type: 'terminal-spawn',
      timestamp: Date.now(),
      payload: { projectId: 'proj-1', terminalId: 't2' },
    });
    expect(manager.spawnCalls).toHaveLength(0);
  });

  it('ignores non-terminal messages', () => {
    setupDaemonTerminal({
      client: client as never,
      projectId: 'proj-1',
      manager,
    });

    client.emit('message', {
      type: 'request-status',
      timestamp: Date.now(),
      payload: { projectId: 'proj-1' },
    });

    expect(manager.spawnCalls).toHaveLength(0);
    expect(manager.writeCalls).toHaveLength(0);
    expect(manager.resizeCalls).toHaveLength(0);
    expect(manager.killCalls).toHaveLength(0);
  });

  it('does not throw when terminal-input targets non-existent session', () => {
    setupDaemonTerminal({
      client: client as never,
      projectId: 'proj-1',
      manager,
    });

    // Override write to throw like the real manager
    manager.write = () => { throw new Error('No session'); };

    expect(() => {
      client.emit('message', {
        type: 'terminal-input',
        timestamp: Date.now(),
        payload: { projectId: 'proj-1', sessionId: 'ghost', data: 'x' },
      });
    }).not.toThrow();
  });
});
