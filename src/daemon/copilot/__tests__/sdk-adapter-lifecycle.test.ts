import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
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

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async send(): Promise<string> { return 'msg-id'; }
  async abort(): Promise<void> { /* does NOT remove from registry */ }
  async disconnect(): Promise<void> { this.handlers = []; }
  async destroy(): Promise<void> { await this.disconnect(); }
  async getMessages(): Promise<SessionEvent[]> { return []; }
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

  it('abort calls deleteSession on the client', async () => {
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

    // Verify deleteSession was called
    const deleteCalls = client.calls.filter(c => c.method === 'deleteSession');
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0].args[0]).toBe(sessionId);

    // Verify session removed from SDK registry
    sent = [];
    await manager.handleMessage({
      type: 'copilot-list-sessions',
      timestamp: Date.now(),
      payload: { requestId: 'list-3' },
    });

    const listMsg = sent.find(m => m.type === 'copilot-session-list');
    expect(listMsg!.payload.sessions.length).toBe(0);
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
    expect(methodNames).toContain('deleteSession');
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

    // Verify 2 remain in registry
    sent = [];
    await manager.handleMessage({
      type: 'copilot-list-sessions',
      timestamp: Date.now(),
      payload: { requestId: 'list-final' },
    });

    const listMsg = sent.find(m => m.type === 'copilot-session-list');
    expect(listMsg!.payload.sessions.length).toBe(2);
    const ids = listMsg!.payload.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).not.toContain(secondSessionId);
  });
});
