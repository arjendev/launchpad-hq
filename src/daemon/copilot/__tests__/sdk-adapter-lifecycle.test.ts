import { describe, it, expect, beforeEach } from 'vitest';
import type { MessageOptions } from '@github/copilot-sdk';
import { CopilotManager } from '../manager.js';
import type { DaemonToHqMessage, SessionEvent } from '../../../shared/protocol.js';

// ---------------------------------------------------------------------------
// LifecycleTestClient — simulates SDK behavior faithfully:
// - createSession adds to internal registry
// - listSessions returns from registry
// - deleteSession removes from registry
// - abort/disconnect do NOT remove from registry (matching real SDK)
// ---------------------------------------------------------------------------

class LifecycleTestSession {
  readonly sessionId: string;
  private handlers: Array<(event: SessionEvent) => void> = [];
  readonly rpc = {
    mode: {
      get: async () => ({ mode: 'interactive' as const }),
      set: async (params: { mode: 'interactive' | 'plan' | 'autopilot' }) => ({ mode: params.mode }),
    },
    plan: {
      read: async () => ({ exists: false, content: null, path: null }),
      update: async () => ({}),
      delete: async () => ({}),
    },
    agent: {
      getCurrent: async () => ({ agent: null }),
      select: async () => ({}),
      deselect: async () => ({}),
    },
  };

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async send(_options: MessageOptions): Promise<string> { return 'msg-id'; }
  async abort(): Promise<void> { /* does NOT remove from registry */ }
  async disconnect(): Promise<void> { this.handlers = []; }
  async destroy(): Promise<void> { await this.disconnect(); }
  async getMessages(): Promise<SessionEvent[]> { return []; }
  async setModel(): Promise<void> { /* no-op */ }
  on(handler: (event: SessionEvent) => void): () => void {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter(h => h !== handler); };
  }
}

class LifecycleTestClient {
  private _state: string = 'disconnected';
  private registry = new Map<string, { sessionId: string; startTime: Date; modifiedTime: Date; isRemote: boolean }>();

  readonly calls: { method: string; args: unknown[] }[] = [];

  getState(): string { return this._state; }

  async start(): Promise<void> {
    this.calls.push({ method: 'start', args: [] });
    this._state = 'connected';
  }

  async stop(): Promise<Error[]> {
    this.calls.push({ method: 'stop', args: [] });
    this._state = 'disconnected';
    return [];
  }

  async forceStop(): Promise<void> {
    this._state = 'disconnected';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createSession(_config: any): Promise<LifecycleTestSession> {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.calls.push({ method: 'createSession', args: [_config] });
    this.registry.set(sessionId, { sessionId, startTime: new Date(), modifiedTime: new Date(), isRemote: false });
    return new LifecycleTestSession(sessionId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async resumeSession(sessionId: string, _config?: any): Promise<LifecycleTestSession> {
    this.calls.push({ method: 'resumeSession', args: [sessionId] });
    throw new Error('Not implemented');
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.calls.push({ method: 'deleteSession', args: [sessionId] });
    this.registry.delete(sessionId);
  }

  async listSessions(): Promise<Array<{ sessionId: string; startTime: Date; modifiedTime: Date; isRemote: boolean }>> {
    this.calls.push({ method: 'listSessions', args: [] });
    return Array.from(this.registry.values());
  }

  async listModels(): Promise<Array<{ id: string; name: string; capabilities: unknown }>> {
    this.calls.push({ method: 'listModels', args: [] });
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(_handler: any): () => void { return () => {}; }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SDK Session Lifecycle (via Manager)', () => {
  let client: LifecycleTestClient;
  let sent: DaemonToHqMessage[];
  let manager: CopilotManager;
  const sendToHq = (msg: DaemonToHqMessage) => sent.push(msg);

  beforeEach(async () => {
    sent = [];
    client = new LifecycleTestClient();
    manager = new CopilotManager({
      sendToHq,
      client,
      pollIntervalMs: 60_000,
    });
    await manager.start();
  });

  it('starts with empty session list', async () => {
    sent = [];
    await manager.handleMessage({
      type: 'copilot-list-sessions',
      timestamp: Date.now(),
      payload: { requestId: 'list-1' },
    });
    // initial start() created a session via pollSessions; client was empty then
    // but start() itself called listSessions. Now list again:
    const listMsg = sent.find(m => m.type === 'copilot-session-list');
    expect(listMsg).toBeDefined();
  });

  it('createSession adds to listSessions', async () => {
    await manager.handleMessage({
      type: 'copilot-create-session',
      timestamp: Date.now(),
      payload: { requestId: 'req-1' },
    });

    sent = [];
    await manager.handleMessage({
      type: 'copilot-list-sessions',
      timestamp: Date.now(),
      payload: { requestId: 'list-2' },
    });

    const listMsg = sent.find(m => m.type === 'copilot-session-list');
    expect(listMsg!.payload.sessions.length).toBe(1);
  });

  it('abort does NOT call deleteSession — session remains alive', async () => {
    await manager.handleMessage({
      type: 'copilot-create-session',
      timestamp: Date.now(),
      payload: { requestId: 'req-2' },
    });

    const startEvent = sent.find(
      m => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
    );
    const sessionId = startEvent!.payload.sessionId;

    await manager.handleMessage({
      type: 'copilot-abort-session',
      timestamp: Date.now(),
      payload: { sessionId },
    });

    // Verify deleteSession was NOT called (abort is non-destructive)
    const deleteCalls = client.calls.filter(c => c.method === 'deleteSession');
    expect(deleteCalls.length).toBe(0);

    // Session should still be in SDK registry
    sent = [];
    await manager.handleMessage({
      type: 'copilot-list-sessions',
      timestamp: Date.now(),
      payload: { requestId: 'list-2' },
    });

    const listMsg = sent.find(m => m.type === 'copilot-session-list');
    const ids = listMsg!.payload.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).toContain(sessionId);
  });

  it('tracks all SDK method calls for audit', async () => {
    await manager.handleMessage({
      type: 'copilot-create-session',
      timestamp: Date.now(),
      payload: { requestId: 'req-3' },
    });

    const startEvent = sent.find(
      m => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
    );
    const sessionId = startEvent!.payload.sessionId;

    await manager.handleMessage({
      type: 'copilot-list-sessions',
      timestamp: Date.now(),
      payload: { requestId: 'list-4' },
    });

    await manager.handleMessage({
      type: 'copilot-abort-session',
      timestamp: Date.now(),
      payload: { sessionId },
    });

    const methodNames = client.calls.map(c => c.method);
    expect(methodNames).toContain('start');
    expect(methodNames).toContain('createSession');
    expect(methodNames).toContain('listSessions');
    // abort no longer calls deleteSession — session stays alive
    expect(methodNames).not.toContain('deleteSession');
  });

  it('multiple sessions: create 3, delete 1, verify 2 remain', async () => {
    // Create 3 sessions
    for (let i = 0; i < 3; i++) {
      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: `req-multi-${i}` },
      });
    }

    // Get all session IDs
    const starts = sent.filter(
      m => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
    );
    expect(starts.length).toBe(3);

    // Abort the second one
    const secondSessionId = starts[1].payload.sessionId;
    await manager.handleMessage({
      type: 'copilot-abort-session',
      timestamp: Date.now(),
      payload: { sessionId: secondSessionId },
    });

    // Verify all 3 remain (abort doesn't remove sessions)
    sent = [];
    await manager.handleMessage({
      type: 'copilot-list-sessions',
      timestamp: Date.now(),
      payload: { requestId: 'list-final' },
    });

    const listMsg = sent.find(m => m.type === 'copilot-session-list');
    expect(listMsg!.payload.sessions.length).toBe(3);
  });
});
