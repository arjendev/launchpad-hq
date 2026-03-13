import { describe, it, expect, beforeEach } from 'vitest';
import type {
  CopilotAdapter,
  CopilotSession,
  CopilotSessionEvent,
  CopilotSdkSessionInfo,
  CopilotSdkState,
  SessionConfig,
} from '../adapter.js';

// ---------------------------------------------------------------------------
// LifecycleTestAdapter — simulates SDK behavior faithfully:
// - createSession adds to internal registry
// - listSessions returns from registry
// - deleteSession removes from registry
// - abort does NOT remove from registry (matching real SDK behavior)
// ---------------------------------------------------------------------------

class LifecycleTestAdapter implements CopilotAdapter {
  private _state: CopilotSdkState = 'disconnected';
  private registry = new Map<string, CopilotSdkSessionInfo>();
  private stateHandlers: Array<(s: CopilotSdkState) => void> = [];

  /** Track all calls for assertions */
  readonly calls: { method: string; args: unknown[] }[] = [];

  get state() { return this._state; }

  async start() {
    this.calls.push({ method: 'start', args: [] });
    this._state = 'connected';
  }

  async stop() {
    this.calls.push({ method: 'stop', args: [] });
    this._state = 'disconnected';
  }

  async listSessions(): Promise<CopilotSdkSessionInfo[]> {
    this.calls.push({ method: 'listSessions', args: [] });
    return Array.from(this.registry.values());
  }

  async getLastSessionId(): Promise<string | null> {
    return null;
  }

  async createSession(config: SessionConfig): Promise<CopilotSession> {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.calls.push({ method: 'createSession', args: [config] });

    // Add to registry (like real SDK does)
    this.registry.set(sessionId, { sessionId });

    // Return a test session — abort/destroy do NOT remove from registry
    const session: CopilotSession = {
      sessionId,
      async send() { return 'test response'; },
      async abort() { /* does NOT remove from registry — matching real SDK */ },
      async getMessages() { return []; },
      on(_handler: (event: CopilotSessionEvent) => void) { return () => {}; },
      async destroy() { /* does NOT remove from registry — matching real SDK */ },
    };
    return session;
  }

  async resumeSession(sessionId: string): Promise<CopilotSession> {
    this.calls.push({ method: 'resumeSession', args: [sessionId] });
    throw new Error('Not implemented');
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.calls.push({ method: 'deleteSession', args: [sessionId] });
    this.registry.delete(sessionId);
  }

  onStateChange(handler: (state: CopilotSdkState) => void) {
    this.stateHandlers.push(handler);
    return () => { /* unsubscribe */ };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SDK Adapter Session Lifecycle', () => {
  let adapter: LifecycleTestAdapter;

  beforeEach(() => {
    adapter = new LifecycleTestAdapter();
  });

  it('starts with empty session list', async () => {
    await adapter.start();
    const sessions = await adapter.listSessions();
    expect(sessions).toHaveLength(0);
  });

  it('createSession adds to listSessions', async () => {
    await adapter.start();
    const session = await adapter.createSession({});
    const sessions = await adapter.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(session.sessionId);
  });

  it('abort does NOT remove from listSessions (proving the bug)', async () => {
    await adapter.start();
    const session = await adapter.createSession({});
    await session.abort();
    const sessions = await adapter.listSessions();
    // This is the BUG: abort doesn't remove from SDK registry
    expect(sessions).toHaveLength(1);
  });

  it('destroy does NOT remove from listSessions (proving the bug)', async () => {
    await adapter.start();
    const session = await adapter.createSession({});
    await session.destroy();
    const sessions = await adapter.listSessions();
    // This is also a BUG: disconnect/destroy doesn't remove either
    expect(sessions).toHaveLength(1);
  });

  it('deleteSession removes from listSessions (the fix)', async () => {
    await adapter.start();
    const session = await adapter.createSession({});

    // Verify it's there
    let sessions = await adapter.listSessions();
    expect(sessions).toHaveLength(1);

    // Delete it
    await adapter.deleteSession(session.sessionId);

    // Verify it's gone
    sessions = await adapter.listSessions();
    expect(sessions).toHaveLength(0);
  });

  it('full lifecycle: list → create → verify → delete → verify', async () => {
    await adapter.start();

    // Step 1: Empty
    expect(await adapter.listSessions()).toHaveLength(0);

    // Step 2: Create
    const session = await adapter.createSession({});

    // Step 3: Verify added
    let sessions = await adapter.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(session.sessionId);

    // Step 4: Delete
    await adapter.deleteSession(session.sessionId);

    // Step 5: Verify removed
    sessions = await adapter.listSessions();
    expect(sessions).toHaveLength(0);
  });

  it('multiple sessions: create 3, delete 1, verify 2 remain', async () => {
    await adapter.start();

    const s1 = await adapter.createSession({});
    const s2 = await adapter.createSession({});
    const s3 = await adapter.createSession({});

    expect(await adapter.listSessions()).toHaveLength(3);

    await adapter.deleteSession(s2.sessionId);

    const remaining = await adapter.listSessions();
    expect(remaining).toHaveLength(2);
    expect(remaining.map(s => s.sessionId)).not.toContain(s2.sessionId);
    expect(remaining.map(s => s.sessionId)).toContain(s1.sessionId);
    expect(remaining.map(s => s.sessionId)).toContain(s3.sessionId);
  });

  it('deleteSession for non-existent session is a no-op', async () => {
    await adapter.start();
    // Should not throw
    await adapter.deleteSession('non-existent-id');
    expect(await adapter.listSessions()).toHaveLength(0);
  });

  it('tracks all method calls for audit', async () => {
    await adapter.start();
    const session = await adapter.createSession({});
    await adapter.listSessions();
    await adapter.deleteSession(session.sessionId);
    await adapter.listSessions();

    const methodNames = adapter.calls.map(c => c.method);
    expect(methodNames).toEqual([
      'start',
      'createSession',
      'listSessions',
      'deleteSession',
      'listSessions',
    ]);
  });
});
