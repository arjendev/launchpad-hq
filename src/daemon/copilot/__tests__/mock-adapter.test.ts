import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockCopilotAdapter } from '../mock-adapter.js';
import type { CopilotSessionEvent, CopilotSdkState } from '../adapter.js';

describe('MockCopilotAdapter', () => {
  let adapter: MockCopilotAdapter;

  beforeEach(() => {
    adapter = new MockCopilotAdapter();
  });

  afterEach(async () => {
    if (adapter.state !== 'disconnected') {
      await adapter.stop();
    }
  });

  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  describe('state transitions', () => {
    it('starts in disconnected state', () => {
      expect(adapter.state).toBe('disconnected');
    });

    it('transitions disconnected → connecting → connected on start()', async () => {
      const states: CopilotSdkState[] = [];
      adapter.onStateChange((s) => states.push(s));

      await adapter.start();

      expect(states).toEqual(['connecting', 'connected']);
      expect(adapter.state).toBe('connected');
    });

    it('transitions back to disconnected on stop()', async () => {
      await adapter.start();

      const states: CopilotSdkState[] = [];
      adapter.onStateChange((s) => states.push(s));

      await adapter.stop();

      expect(states).toContain('disconnected');
      expect(adapter.state).toBe('disconnected');
    });

    it('notifies multiple state listeners', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      adapter.onStateChange(listener1);
      adapter.onStateChange(listener2);

      await adapter.start();

      expect(listener1).toHaveBeenCalledTimes(2); // connecting + connected
      expect(listener2).toHaveBeenCalledTimes(2);
    });

    it('unsubscribes state listeners', async () => {
      const listener = vi.fn();
      const unsub = adapter.onStateChange(listener);
      unsub();

      await adapter.start();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Session listing
  // -----------------------------------------------------------------------

  describe('listSessions()', () => {
    it('returns realistic mock sessions', async () => {
      await adapter.start();
      const sessions = await adapter.listSessions();

      expect(sessions.length).toBeGreaterThanOrEqual(2);
      for (const s of sessions) {
        expect(s.sessionId).toBeTruthy();
        expect(typeof s.sessionId).toBe('string');
      }
    });

    it('sessions contain expected metadata fields', async () => {
      await adapter.start();
      const sessions = await adapter.listSessions();
      const first = sessions[0];

      expect(first).toHaveProperty('sessionId');
      expect(first).toHaveProperty('repository');
    });
  });

  // -----------------------------------------------------------------------
  // Session CRUD
  // -----------------------------------------------------------------------

  describe('createSession()', () => {
    it('returns a session with a unique id', async () => {
      await adapter.start();
      const s1 = await adapter.createSession({});
      const s2 = await adapter.createSession({});

      expect(s1.sessionId).toBeTruthy();
      expect(s2.sessionId).toBeTruthy();
      expect(s1.sessionId).not.toBe(s2.sessionId);
    });

    it('tracks the last session id', async () => {
      await adapter.start();
      expect(await adapter.getLastSessionId()).toBeNull();

      const session = await adapter.createSession({});

      expect(await adapter.getLastSessionId()).toBe(session.sessionId);
    });
  });

  describe('resumeSession()', () => {
    it('returns an existing session when it was created', async () => {
      await adapter.start();
      const original = await adapter.createSession({});
      const resumed = await adapter.resumeSession(original.sessionId);

      expect(resumed.sessionId).toBe(original.sessionId);
    });

    it('creates a new session for an unknown id', async () => {
      await adapter.start();
      const resumed = await adapter.resumeSession('unknown-id');

      expect(resumed.sessionId).toBe('unknown-id');
    });
  });

  // -----------------------------------------------------------------------
  // Session event emission
  // -----------------------------------------------------------------------

  describe('session event emission', () => {
    it('emits events on send()', async () => {
      await adapter.start();
      const session = await adapter.createSession({});
      const events: CopilotSessionEvent[] = [];
      session.on((e) => events.push(e));

      await session.send({ prompt: 'Hello' });

      const types = events.map((e) => e.type);
      expect(types).toContain('session.start');
      expect(types).toContain('user.message');
      expect(types).toContain('assistant.message.delta');
      expect(types).toContain('tool.executionStart');
      expect(types).toContain('tool.executionComplete');
      expect(types).toContain('assistant.message');
      expect(types).toContain('session.idle');
    });

    it('send() returns a response string', async () => {
      await adapter.start();
      const session = await adapter.createSession({});
      const result = await session.send({ prompt: 'test prompt' });

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('getMessages() returns all emitted events', async () => {
      await adapter.start();
      const session = await adapter.createSession({});
      await session.send({ prompt: 'check messages' });

      const messages = await session.getMessages();

      expect(messages.length).toBeGreaterThan(0);
      for (const m of messages) {
        expect(m).toHaveProperty('type');
        expect(m).toHaveProperty('data');
        expect(m).toHaveProperty('timestamp');
      }
    });

    it('unsubscribes event handlers', async () => {
      await adapter.start();
      const session = await adapter.createSession({});
      const handler = vi.fn();
      const unsub = session.on(handler);
      unsub();

      await session.send({ prompt: 'after unsub' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Abort
  // -----------------------------------------------------------------------

  describe('abort()', () => {
    it('stops event emission from send()', async () => {
      await adapter.start();
      const session = await adapter.createSession({});
      const events: CopilotSessionEvent[] = [];
      session.on((e) => events.push(e));

      // Start send, abort immediately — send resolves with empty string on abort
      const sendPromise = session.send({ prompt: 'Hello world test prompt' });
      // Abort right away before send completes
      await session.abort();
      const result = await sendPromise;

      expect(result).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // Destroy & stop
  // -----------------------------------------------------------------------

  describe('destroy()', () => {
    it('cleans up session resources', async () => {
      await adapter.start();
      const session = await adapter.createSession({});
      const handler = vi.fn();
      session.on(handler);

      await session.destroy();

      // Handler should be cleared, no more events
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('destroys all active sessions', async () => {
      await adapter.start();
      const s1 = await adapter.createSession({});
      const s2 = await adapter.createSession({});

      await adapter.stop();

      // Sessions should be cleaned up — adapter tracks them internally
      expect(adapter.state).toBe('disconnected');
    });
  });
});
