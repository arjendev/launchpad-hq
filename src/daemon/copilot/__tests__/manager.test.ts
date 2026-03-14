import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CopilotManager } from '../manager.js';
import type { DaemonToHqMessage, HqToDaemonMessage, SessionEvent } from '../../../shared/protocol.js';

// ---------------------------------------------------------------------------
// Mock SDK session — duck-typed to match CopilotSession from the SDK
// ---------------------------------------------------------------------------

class TestSdkSession {
  readonly sessionId: string;
  private handlers: Array<(event: SessionEvent) => void> = [];
  private _model = 'gpt-4';
  private _mode: 'interactive' | 'plan' | 'autopilot' = 'interactive';
  private _plan: { exists: boolean; content: string | null; path: string | null } = {
    exists: false,
    content: null,
    path: null,
  };

  /** Session-scoped RPC — mirrors SDK createSessionRpc() shape */
  readonly rpc = {
    mode: {
      get: async () => ({ mode: this._mode }),
      set: async (params: { mode: 'interactive' | 'plan' | 'autopilot' }) => {
        this._mode = params.mode;
        return { mode: this._mode };
      },
    },
    plan: {
      read: async () => ({ ...this._plan }),
      update: async (params: { content: string }) => {
        this._plan = { exists: true, content: params.content, path: '/tmp/plan.md' };
        return {};
      },
      delete: async () => {
        this._plan = { exists: false, content: null, path: null };
        return {};
      },
    },
  };

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async send(options: { prompt: string }): Promise<string> {
    const msgId = randomUUID();
    this.dispatch({ type: 'user.message', data: { content: options.prompt } });
    this.dispatch({ type: 'assistant.streaming_delta', data: { delta: 'Test response' } });
    this.dispatch({ type: 'tool.execution_start', data: { tool: 'test_tool' } });
    this.dispatch({ type: 'tool.execution_complete', data: { tool: 'test_tool' } });
    this.dispatch({ type: 'assistant.message', data: { content: `Response to: "${options.prompt}"` } });
    this.dispatch({ type: 'session.idle', data: {} });
    return msgId;
  }

  on(handler: (event: SessionEvent) => void): () => void {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter((h) => h !== handler); };
  }

  async abort(): Promise<void> { /* no-op */ }
  async getMessages(): Promise<SessionEvent[]> { return []; }
  async disconnect(): Promise<void> { this.handlers = []; }
  async destroy(): Promise<void> { await this.disconnect(); }

  async setModel(model: string): Promise<void> { this._model = model; }
  get currentModel(): string { return this._model; }

  private dispatch(partial: { type: string; data: Record<string, unknown> }): void {
    const event = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      parentId: null,
      ...partial,
    } as SessionEvent;
    for (const handler of this.handlers) handler(event);
  }
}

// ---------------------------------------------------------------------------
// Mock SDK client — duck-typed to match CopilotClient from the SDK
// ---------------------------------------------------------------------------

class TestCopilotClient {
  private _state: string = 'disconnected';
  private sessions = new Map<string, TestSdkSession>();
  private lifecycleHandlers: Array<(event: unknown) => void> = [];

  getState(): string { return this._state; }

  async start(): Promise<void> {
    this._state = 'connecting';
    this._state = 'connected';
  }

  async stop(): Promise<Error[]> {
    this.sessions.clear();
    this._state = 'disconnected';
    return [];
  }

  async forceStop(): Promise<void> {
    this.sessions.clear();
    this._state = 'disconnected';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createSession(_config: any): Promise<TestSdkSession> {
    const id = `test-${randomUUID().slice(0, 8)}`;
    const session = new TestSdkSession(id);
    this.sessions.set(id, session);
    return session;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async resumeSession(sessionId: string, _config?: any): Promise<TestSdkSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const session = new TestSdkSession(sessionId);
    this.sessions.set(sessionId, session);
    return session;
  }

  async deleteSession(_sessionId: string): Promise<void> { /* no-op */ }

  async listModels(): Promise<Array<{ id: string; name: string; capabilities: unknown }>> {
    return [
      { id: 'gpt-4', name: 'GPT-4', capabilities: { supports: {}, limits: { max_context_window_tokens: 128000 } } },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet', capabilities: { supports: {}, limits: { max_context_window_tokens: 200000 } } },
    ];
  }

  async listSessions(): Promise<Array<{ sessionId: string; startTime: Date; modifiedTime: Date; isRemote: boolean; summary?: string }>> {
    return [
      { sessionId: 'test-session-001', startTime: new Date(), modifiedTime: new Date(), isRemote: false, summary: 'Test session' },
    ];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(handler: any): () => void {
    this.lifecycleHandlers.push(handler);
    return () => { this.lifecycleHandlers = this.lifecycleHandlers.filter((h) => h !== handler); };
  }
}

// ---------------------------------------------------------------------------
// Failing client — simulates SDK start failure
// ---------------------------------------------------------------------------

class FailingCopilotClient extends TestCopilotClient {
  override async start(): Promise<void> {
    throw new Error('Copilot CLI not found in PATH');
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CopilotManager', () => {
  let manager: CopilotManager;
  let sent: DaemonToHqMessage[];
  const sendToHq = (msg: DaemonToHqMessage) => sent.push(msg);

  beforeEach(() => {
    sent = [];
    manager = new CopilotManager({
      sendToHq,
      client: new TestCopilotClient(),
      pollIntervalMs: 60_000,
    });
  });

  afterEach(async () => {
    await manager.stop();
  });

  // -----------------------------------------------------------------------
  // Start / Stop lifecycle
  // -----------------------------------------------------------------------

  describe('start()', () => {
    it('transitions to connected state', async () => {
      await manager.start();
      expect(manager.connectionState).toBe('connected');
    });

    it('sends copilot-sdk-state messages during startup', async () => {
      await manager.start();
      const stateMessages = sent.filter((m) => m.type === 'copilot-sdk-state');
      expect(stateMessages.length).toBeGreaterThanOrEqual(2);
      expect(stateMessages[0].payload.state).toBe('connecting');
      expect(stateMessages[1].payload.state).toBe('connected');
    });

    it('sends initial session list on start', async () => {
      await manager.start();
      const listMessages = sent.filter((m) => m.type === 'copilot-session-list');
      expect(listMessages.length).toBeGreaterThanOrEqual(1);
      expect(listMessages[0].payload.sessions.length).toBeGreaterThan(0);
    });
  });

  describe('stop()', () => {
    it('disconnects cleanly', async () => {
      await manager.start();
      await manager.stop();
      expect(manager.connectionState).toBe('disconnected');
    });
  });

  // -----------------------------------------------------------------------
  // Graceful failure — SDK start fails
  // -----------------------------------------------------------------------

  describe('start() with failing client', () => {
    it('does not throw when SDK fails to start', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const failManager = new CopilotManager({
        sendToHq,
        client: new FailingCopilotClient(),
        pollIntervalMs: 60_000,
      });

      await failManager.start();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Copilot SDK failed to start'),
      );

      await failManager.stop();
      warnSpy.mockRestore();
    });

    it('does not start polling when SDK fails', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const failManager = new CopilotManager({
        sendToHq,
        client: new FailingCopilotClient(),
        pollIntervalMs: 60_000,
      });

      await failManager.start();

      const listMessages = sent.filter((m) => m.type === 'copilot-session-list');
      expect(listMessages).toHaveLength(0);

      await failManager.stop();
      vi.restoreAllMocks();
    });
  });

  // -----------------------------------------------------------------------
  // copilot-create-session command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-create-session', () => {
    it('creates a session and emits session.start event', async () => {
      await manager.start();
      sent = [];

      const msg: HqToDaemonMessage = {
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-1' },
      };

      await manager.handleMessage(msg);

      const sessionEvents = sent.filter((m) => m.type === 'copilot-session-event');
      const startEvent = sessionEvents.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          m.payload.event.type === 'session.start',
      );
      expect(startEvent).toBeDefined();
      expect(startEvent!.payload.event.data.requestId).toBe('req-1');
    });
  });

  // -----------------------------------------------------------------------
  // copilot-resume-session command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-resume-session', () => {
    it('resumes a session and emits session.start with resumed flag', async () => {
      await manager.start();
      sent = [];

      const msg: HqToDaemonMessage = {
        type: 'copilot-resume-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-2', sessionId: 'test-session-001' },
      };

      await manager.handleMessage(msg);

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          m.payload.event.type === 'session.start',
      );
      expect(startEvent).toBeDefined();
      expect(startEvent!.payload.event.data.resumed).toBe(true);
      expect(startEvent!.payload.sessionId).toBe('test-session-001');
    });
  });

  // -----------------------------------------------------------------------
  // copilot-send-prompt command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-send-prompt', () => {
    it('sends prompt and forwards session events to HQ', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-3' },
      });

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-send-prompt',
        timestamp: Date.now(),
        payload: { sessionId, prompt: 'Hello world' },
      });

      const events = sent.filter((m) => m.type === 'copilot-session-event');
      const eventTypes = events.map((m) => m.payload.event.type);

      expect(eventTypes).toContain('assistant.message');
      expect(eventTypes).toContain('session.idle');
    });

    it('sends error event for unknown session', async () => {
      await manager.start();
      sent = [];

      await manager.handleMessage({
        type: 'copilot-send-prompt',
        timestamp: Date.now(),
        payload: { sessionId: 'nonexistent', prompt: 'Hello' },
      });

      const errorEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          m.payload.event.type === 'session.error',
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.payload.sessionId).toBe('nonexistent');
    });
  });

  // -----------------------------------------------------------------------
  // copilot-abort-session command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-abort-session', () => {
    it('aborts an active session and emits session.shutdown', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-4' },
      });

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-abort-session',
        timestamp: Date.now(),
        payload: { sessionId },
      });

      const shutdownEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          m.payload.event.type === 'session.shutdown',
      );
      expect(shutdownEvent).toBeDefined();
      expect(shutdownEvent!.payload.sessionId).toBe(sessionId);
    });

    it('removes session from activeSessions after abort', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-4b' },
      });

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-abort-session',
        timestamp: Date.now(),
        payload: { sessionId },
      });

      // Sending a prompt to the aborted session should yield an error
      sent = [];
      await manager.handleMessage({
        type: 'copilot-send-prompt',
        timestamp: Date.now(),
        payload: { sessionId, prompt: 'Should fail' },
      });

      const errorEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          m.payload.event.type === 'session.error',
      );
      expect(errorEvent).toBeDefined();
    });

    it('silently handles abort for unknown session', async () => {
      await manager.start();
      // Should not throw
      await manager.handleMessage({
        type: 'copilot-abort-session',
        timestamp: Date.now(),
        payload: { sessionId: 'nonexistent' },
      });
    });
  });

  // -----------------------------------------------------------------------
  // copilot-list-sessions command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-list-sessions', () => {
    it('sends session list with the given requestId', async () => {
      await manager.start();
      sent = [];

      await manager.handleMessage({
        type: 'copilot-list-sessions',
        timestamp: Date.now(),
        payload: { requestId: 'req-5' },
      });

      const listMsg = sent.find((m) => m.type === 'copilot-session-list');
      expect(listMsg).toBeDefined();
      expect(listMsg!.payload.requestId).toBe('req-5');
      expect(listMsg!.payload.sessions.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Session event forwarding
  // -----------------------------------------------------------------------

  describe('session event forwarding', () => {
    it('forwards all session events to HQ as-is (no mapping)', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-6' },
      });

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-send-prompt',
        timestamp: Date.now(),
        payload: { sessionId, prompt: 'test forwarding' },
      });

      const forwarded = sent.filter(
        (m) => m.type === 'copilot-session-event' && m.payload.sessionId === sessionId,
      );

      expect(forwarded.length).toBeGreaterThan(3);

      // Verify SDK event names are forwarded as-is (no renaming)
      const types = forwarded.map(m => m.payload.event.type);
      expect(types).toContain('tool.execution_start');
      expect(types).toContain('assistant.streaming_delta');
    });
  });

  // -----------------------------------------------------------------------
  // Ignores non-copilot messages
  // -----------------------------------------------------------------------

  describe('handleMessage: non-copilot messages', () => {
    it('ignores unrelated message types', async () => {
      await manager.start();
      sent = [];

      await manager.handleMessage({
        type: 'request-status',
        timestamp: Date.now(),
        payload: { projectId: 'proj-1' },
      });

      const copilotMessages = sent.filter((m) => m.type.startsWith('copilot-'));
      expect(copilotMessages).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Default client when no client option provided
  // -----------------------------------------------------------------------

  describe('default client', () => {
    it('starts as disconnected when SDK is available', () => {
      const defaultManager = new CopilotManager({
        sendToHq,
        pollIntervalMs: 60_000,
      });

      expect(defaultManager.connectionState).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // copilot-set-model command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-set-model', () => {
    it('sets model on an active session', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-model-1' },
      });

      const startEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-set-model',
        timestamp: Date.now(),
        payload: { sessionId, model: 'claude-sonnet-4' },
      } as HqToDaemonMessage);

      // No error events should have been sent
      const errors = sent.filter(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.error',
      );
      expect(errors).toHaveLength(0);
    });

    it('silently ignores set-model for unknown session', async () => {
      await manager.start();
      sent = [];

      await manager.handleMessage({
        type: 'copilot-set-model',
        timestamp: Date.now(),
        payload: { sessionId: 'nonexistent', model: 'gpt-4' },
      } as HqToDaemonMessage);

      expect(sent).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // copilot-get-mode command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-get-mode', () => {
    it('returns current mode for an active session', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-mode-1' },
      });

      const startEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-get-mode',
        timestamp: Date.now(),
        payload: { requestId: 'mode-req-1', sessionId },
      } as HqToDaemonMessage);

      const modeResponse = sent.find((m) => m.type === 'copilot-mode-response');
      expect(modeResponse).toBeDefined();
      expect(modeResponse!.payload.requestId).toBe('mode-req-1');
      expect(modeResponse!.payload.sessionId).toBe(sessionId);
      expect(modeResponse!.payload.mode).toBe('interactive');
    });

    it('silently ignores get-mode for unknown session', async () => {
      await manager.start();
      sent = [];

      await manager.handleMessage({
        type: 'copilot-get-mode',
        timestamp: Date.now(),
        payload: { requestId: 'mode-req-2', sessionId: 'nonexistent' },
      } as HqToDaemonMessage);

      expect(sent).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // copilot-set-mode command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-set-mode', () => {
    it('sets mode on an active session', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-setmode-1' },
      });

      const startEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-set-mode',
        timestamp: Date.now(),
        payload: { sessionId, mode: 'autopilot' },
      } as HqToDaemonMessage);

      // Verify mode was changed by doing a get
      await manager.handleMessage({
        type: 'copilot-get-mode',
        timestamp: Date.now(),
        payload: { requestId: 'verify-mode', sessionId },
      } as HqToDaemonMessage);

      const modeResponse = sent.find((m) => m.type === 'copilot-mode-response');
      expect(modeResponse!.payload.mode).toBe('autopilot');
    });
  });

  // -----------------------------------------------------------------------
  // copilot-get-plan command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-get-plan', () => {
    it('returns plan for an active session', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-plan-1' },
      });

      const startEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-get-plan',
        timestamp: Date.now(),
        payload: { requestId: 'plan-req-1', sessionId },
      } as HqToDaemonMessage);

      const planResponse = sent.find((m) => m.type === 'copilot-plan-response');
      expect(planResponse).toBeDefined();
      expect(planResponse!.payload.requestId).toBe('plan-req-1');
      expect(planResponse!.payload.sessionId).toBe(sessionId);
      expect(planResponse!.payload.plan.exists).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // copilot-update-plan command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-update-plan', () => {
    it('updates plan and verifies via get-plan', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-updateplan-1' },
      });

      const startEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-update-plan',
        timestamp: Date.now(),
        payload: { sessionId, content: '# My Plan\n\n- Step 1\n- Step 2' },
      } as HqToDaemonMessage);

      // Verify plan was updated
      await manager.handleMessage({
        type: 'copilot-get-plan',
        timestamp: Date.now(),
        payload: { requestId: 'verify-plan', sessionId },
      } as HqToDaemonMessage);

      const planResponse = sent.find((m) => m.type === 'copilot-plan-response');
      expect(planResponse!.payload.plan.exists).toBe(true);
      expect(planResponse!.payload.plan.content).toBe('# My Plan\n\n- Step 1\n- Step 2');
    });
  });

  // -----------------------------------------------------------------------
  // copilot-delete-plan command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-delete-plan', () => {
    it('deletes an existing plan', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-delplan-1' },
      });

      const startEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;

      // First create a plan
      await manager.handleMessage({
        type: 'copilot-update-plan',
        timestamp: Date.now(),
        payload: { sessionId, content: 'temp plan' },
      } as HqToDaemonMessage);

      // Then delete it
      await manager.handleMessage({
        type: 'copilot-delete-plan',
        timestamp: Date.now(),
        payload: { sessionId },
      } as HqToDaemonMessage);

      sent = [];

      // Verify plan is gone
      await manager.handleMessage({
        type: 'copilot-get-plan',
        timestamp: Date.now(),
        payload: { requestId: 'verify-deleted', sessionId },
      } as HqToDaemonMessage);

      const planResponse = sent.find((m) => m.type === 'copilot-plan-response');
      expect(planResponse!.payload.plan.exists).toBe(false);
      expect(planResponse!.payload.plan.content).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // copilot-disconnect-session command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-disconnect-session', () => {
    it('disconnects session and emits session.shutdown', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-disc-1' },
      });

      const startEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-disconnect-session',
        timestamp: Date.now(),
        payload: { sessionId },
      } as HqToDaemonMessage);

      const shutdownEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.shutdown',
      );
      expect(shutdownEvent).toBeDefined();
      expect(shutdownEvent!.payload.event.data.reason).toBe('disconnected');
    });

    it('removes session from tracking after disconnect', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-disc-2' },
      });

      const startEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;

      await manager.handleMessage({
        type: 'copilot-disconnect-session',
        timestamp: Date.now(),
        payload: { sessionId },
      } as HqToDaemonMessage);

      // Sending a prompt to the disconnected session should yield an error
      sent = [];
      await manager.handleMessage({
        type: 'copilot-send-prompt',
        timestamp: Date.now(),
        payload: { sessionId, prompt: 'Should fail' },
      });

      const errorEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.error',
      );
      expect(errorEvent).toBeDefined();
    });

    it('silently ignores disconnect for unknown session', async () => {
      await manager.start();
      sent = [];

      await manager.handleMessage({
        type: 'copilot-disconnect-session',
        timestamp: Date.now(),
        payload: { sessionId: 'nonexistent' },
      } as HqToDaemonMessage);

      expect(sent).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // copilot-list-models command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-list-models', () => {
    it('returns available models from the SDK client', async () => {
      await manager.start();
      sent = [];

      await manager.handleMessage({
        type: 'copilot-list-models',
        timestamp: Date.now(),
        payload: { requestId: 'models-req-1' },
      } as HqToDaemonMessage);

      const modelsMsg = sent.find((m) => m.type === 'copilot-models-list');
      expect(modelsMsg).toBeDefined();
      expect(modelsMsg!.payload.requestId).toBe('models-req-1');
      expect(modelsMsg!.payload.models.length).toBe(2);
      expect(modelsMsg!.payload.models[0].id).toBe('gpt-4');
    });
  });

  // -----------------------------------------------------------------------
  // copilot-delete-session command
  // -----------------------------------------------------------------------

  describe('handleMessage: copilot-delete-session', () => {
    it('deletes a session and emits session.shutdown with reason deleted', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-del-1' },
      });

      const startEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      await manager.handleMessage({
        type: 'copilot-delete-session',
        timestamp: Date.now(),
        payload: { sessionId },
      } as HqToDaemonMessage);

      const shutdownEvent = sent.find(
        (m) => m.type === 'copilot-session-event' && m.payload.event.type === 'session.shutdown',
      );
      expect(shutdownEvent).toBeDefined();
      expect(shutdownEvent!.payload.event.data.reason).toBe('deleted');
    });
  });

  // -----------------------------------------------------------------------
  // HQ tools and system message injection
  // -----------------------------------------------------------------------

  describe('HQ tools and system message injection', () => {
    let managerWithProject: CopilotManager;

    beforeEach(() => {
      managerWithProject = new CopilotManager({
        sendToHq,
        client: new TestCopilotClient(),
        pollIntervalMs: 60_000,
        projectId: 'test-project',
        projectName: 'Test Project',
      });
    });

    afterEach(async () => {
      await managerWithProject.stop();
    });

    it('injects HQ tools when creating a session', async () => {
      await managerWithProject.start();
      sent = [];

      await managerWithProject.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-hq-1' },
      });

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          m.payload.event.type === 'session.start',
      );
      expect(startEvent).toBeDefined();
      expect(startEvent!.payload.event.data.requestId).toBe('req-hq-1');
    });

    it('sends tool invocation messages to HQ when tool handlers are called', async () => {
      await managerWithProject.start();

      await managerWithProject.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-hq-3' },
      });

      sent = [];

      const { createHqTools } = await import('../hq-tools.js');
      const tools = createHqTools(sendToHq, 'test-project');

      const progressTool = tools.find((t) => t.name === 'report_progress')!;
      await progressTool.handler({ status: 'working', summary: 'Making progress' }, { sessionId: 'test', toolCallId: 'tc1', toolName: 'report_progress', arguments: {} });

      const invocationMsg = sent.find((m) => m.type === 'copilot-tool-invocation');
      expect(invocationMsg).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Duplicate event prevention (#triple-event regression)
  // -----------------------------------------------------------------------

  describe('duplicate event prevention', () => {
    it('start() is idempotent — calling twice does not leak listeners', async () => {
      await manager.start();
      const countAfterFirst = sent.length;

      // Reset and call start again (simulates daemon reconnect → re-auth)
      sent = [];
      await manager.start();

      // start() should be a no-op — no new messages sent
      expect(sent.length).toBe(0);

      // Session events should still work (exactly 1× per event)
      sent = [];
      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-dup-1' },
      });

      const sessionEvents = sent.filter(
        (m) => m.type === 'copilot-session-event',
      );

      // Should have exactly 1 session.start (the explicit synthetic one,
      // NOT a duplicate from client.on or leaked listener)
      const startEvents = sessionEvents.filter((m) => {
        const payload = m as unknown as {
          payload: { event: { type: string } };
        };
        return payload.payload.event.type === 'session.start';
      });
      expect(startEvents.length).toBe(1);
    });

    it('session.on() sends each event exactly once (no client.on duplication)', async () => {
      await manager.start();

      // Create a session
      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-dup-2' },
      });

      // Find the sessionId from the session.start event
      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          (m as unknown as { payload: { event: { type: string } } }).payload
            .event.type === 'session.start',
      );
      expect(startEvent).toBeDefined();
      const sessionId = (
        startEvent as unknown as { payload: { sessionId: string } }
      ).payload.sessionId;

      // Reset and send a prompt — this generates multiple SDK events
      sent = [];
      await manager.handleMessage({
        type: 'copilot-send-prompt',
        timestamp: Date.now(),
        payload: { sessionId, prompt: 'test message' },
      });

      // Count events by type — each should appear exactly once
      const eventsByType = new Map<string, number>();
      for (const msg of sent) {
        if (msg.type !== 'copilot-session-event') continue;
        const eventType = (
          msg as unknown as { payload: { event: { type: string } } }
        ).payload.event.type;
        eventsByType.set(eventType, (eventsByType.get(eventType) ?? 0) + 1);
      }

      // Each event type should fire exactly once
      for (const [eventType, count] of eventsByType) {
        expect(
          count,
          `Event '${eventType}' should fire exactly once, got ${count}`,
        ).toBe(1);
      }
    });

    it('trackSession cleans up old listener before attaching new one', async () => {
      await manager.start();

      // Create a session
      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-dup-3' },
      });

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-session-event' &&
          (m as unknown as { payload: { event: { type: string } } }).payload
            .event.type === 'session.start',
      );
      const sessionId = (
        startEvent as unknown as { payload: { sessionId: string } }
      ).payload.sessionId;

      // Disconnect + resume (simulates user re-selecting the session)
      await manager.handleMessage({
        type: 'copilot-disconnect-session',
        timestamp: Date.now(),
        payload: { sessionId },
      });
      await manager.handleMessage({
        type: 'copilot-resume-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-dup-4', sessionId },
      });

      // Send a prompt on the resumed session
      sent = [];
      await manager.handleMessage({
        type: 'copilot-send-prompt',
        timestamp: Date.now(),
        payload: { sessionId, prompt: 'test after resume' },
      });

      // Each event type should still appear exactly once
      const eventsByType = new Map<string, number>();
      for (const msg of sent) {
        if (msg.type !== 'copilot-session-event') continue;
        const eventType = (
          msg as unknown as { payload: { event: { type: string } } }
        ).payload.event.type;
        eventsByType.set(eventType, (eventsByType.get(eventType) ?? 0) + 1);
      }

      for (const [eventType, count] of eventsByType) {
        expect(
          count,
          `After resume: event '${eventType}' should fire exactly once, got ${count}`,
        ).toBe(1);
      }
    });
  });
});
