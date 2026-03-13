import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CopilotManager } from '../manager.js';
import type { DaemonToHqMessage, HqToDaemonMessage } from '../../../shared/protocol.js';
import type {
  CopilotAdapter,
  CopilotSession,
  CopilotSessionEvent,
  CopilotSdkSessionInfo,
  CopilotSdkState,
  SessionConfig,
} from '../adapter.js';

// ---------------------------------------------------------------------------
// Inline test adapter — replaces the deleted MockCopilotAdapter for tests
// ---------------------------------------------------------------------------

class TestCopilotSession implements CopilotSession {
  readonly sessionId: string;
  private handlers: Array<(event: CopilotSessionEvent) => void> = [];
  private events: CopilotSessionEvent[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async send(options: { prompt: string }): Promise<string> {
    const response = `Test response to: "${options.prompt}"`;
    this.emit({ type: 'session.start', data: {}, timestamp: Date.now() });
    this.emit({ type: 'user.message', data: { content: options.prompt }, timestamp: Date.now() });
    this.emit({ type: 'assistant.message.delta', data: { delta: response }, timestamp: Date.now() });
    this.emit({ type: 'tool.executionStart', data: { tool: 'test_tool' }, timestamp: Date.now() });
    this.emit({ type: 'tool.executionComplete', data: { tool: 'test_tool' }, timestamp: Date.now() });
    this.emit({ type: 'assistant.message', data: { content: response }, timestamp: Date.now() });
    this.emit({ type: 'session.idle', data: {}, timestamp: Date.now() });
    return response;
  }

  on(handler: (event: CopilotSessionEvent) => void): () => void {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter((h) => h !== handler); };
  }

  async abort(): Promise<void> { /* no-op */ }
  async getMessages(): Promise<CopilotSessionEvent[]> { return [...this.events]; }
  async destroy(): Promise<void> { this.handlers = []; }

  private emit(event: CopilotSessionEvent): void {
    this.events.push(event);
    for (const handler of this.handlers) handler(event);
  }
}

class TestCopilotAdapter implements CopilotAdapter {
  private _state: CopilotSdkState = 'disconnected';
  private stateHandlers: Array<(state: CopilotSdkState) => void> = [];
  private sessions = new Map<string, TestCopilotSession>();

  get state(): CopilotSdkState { return this._state; }

  async start(): Promise<void> {
    this.setState('connecting');
    this.setState('connected');
  }

  async stop(): Promise<void> {
    this.sessions.clear();
    this.setState('disconnected');
  }

  async listSessions(): Promise<CopilotSdkSessionInfo[]> {
    return [
      { sessionId: 'test-session-001', repository: 'test/repo', branch: 'main', summary: 'Test session' },
    ];
  }

  async getLastSessionId(): Promise<string | null> { return null; }

  async createSession(_config: SessionConfig): Promise<CopilotSession> {
    const id = `test-${randomUUID().slice(0, 8)}`;
    const session = new TestCopilotSession(id);
    this.sessions.set(id, session);
    return session;
  }

  async resumeSession(sessionId: string): Promise<CopilotSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const session = new TestCopilotSession(sessionId);
    this.sessions.set(sessionId, session);
    return session;
  }

  onStateChange(handler: (state: CopilotSdkState) => void): () => void {
    this.stateHandlers.push(handler);
    return () => { this.stateHandlers = this.stateHandlers.filter((h) => h !== handler); };
  }

  private setState(next: CopilotSdkState): void {
    this._state = next;
    for (const handler of this.stateHandlers) handler(next);
  }
}

// ---------------------------------------------------------------------------
// Failing adapter — simulates SDK start failure
// ---------------------------------------------------------------------------

class FailingCopilotAdapter extends TestCopilotAdapter {
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
      adapter: new TestCopilotAdapter(),
      pollIntervalMs: 60_000, // long interval to avoid noise in tests
    });
  });

  afterEach(async () => {
    await manager.stop();
  });

  // -----------------------------------------------------------------------
  // Start / Stop lifecycle
  // -----------------------------------------------------------------------

  describe('start()', () => {
    it('transitions adapter to connected state', async () => {
      await manager.start();

      expect(manager.adapterState).toBe('connected');
    });

    it('sends copilot-sdk-state messages during startup', async () => {
      await manager.start();

      const stateMessages = sent.filter((m) => m.type === 'copilot-sdk-state');
      expect(stateMessages.length).toBeGreaterThanOrEqual(2); // connecting + connected
      expect(stateMessages[0].payload.state).toBe('connecting');
      expect(stateMessages[1].payload.state).toBe('connected');
    });

    it('sends initial session list on start', async () => {
      await manager.start();

      const listMessages = sent.filter((m) => m.type === 'copilot-sdk-session-list');
      expect(listMessages.length).toBeGreaterThanOrEqual(1);
      expect(listMessages[0].payload.sessions.length).toBeGreaterThan(0);
    });
  });

  describe('stop()', () => {
    it('transitions adapter to disconnected state', async () => {
      await manager.start();
      await manager.stop();

      expect(manager.adapterState).toBe('disconnected');
    });
  });

  // -----------------------------------------------------------------------
  // Graceful failure — SDK start fails
  // -----------------------------------------------------------------------

  describe('start() with failing adapter', () => {
    it('does not throw when SDK fails to start', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const failManager = new CopilotManager({
        sendToHq,
        adapter: new FailingCopilotAdapter(),
        pollIntervalMs: 60_000,
      });

      // Should not throw
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
        adapter: new FailingCopilotAdapter(),
        pollIntervalMs: 60_000,
      });

      await failManager.start();

      // No session list should be sent
      const listMessages = sent.filter((m) => m.type === 'copilot-sdk-session-list');
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

      const sessionEvents = sent.filter((m) => m.type === 'copilot-sdk-session-event');
      const startEvent = sessionEvents.find(
        (m) =>
          m.type === 'copilot-sdk-session-event' &&
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
          m.type === 'copilot-sdk-session-event' &&
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

      // Create a session first
      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-3' },
      });

      // Find the sessionId from the start event
      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-sdk-session-event' &&
          m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;
      sent = [];

      // Now send a prompt
      await manager.handleMessage({
        type: 'copilot-send-prompt',
        timestamp: Date.now(),
        payload: { sessionId, prompt: 'Hello world' },
      });

      const events = sent.filter((m) => m.type === 'copilot-sdk-session-event');
      const eventTypes = events.map((m) => m.payload.event.type);

      expect(eventTypes).toContain('session.start');
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
          m.type === 'copilot-sdk-session-event' &&
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
    it('aborts an active session without error', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-4' },
      });

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-sdk-session-event' &&
          m.payload.event.type === 'session.start',
      );
      const sessionId = startEvent!.payload.sessionId;

      // Abort should not throw
      await manager.handleMessage({
        type: 'copilot-abort-session',
        timestamp: Date.now(),
        payload: { sessionId },
      });
    });

    it('silently ignores abort for unknown session', async () => {
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

      const listMsg = sent.find((m) => m.type === 'copilot-sdk-session-list');
      expect(listMsg).toBeDefined();
      expect(listMsg!.payload.requestId).toBe('req-5');
      expect(listMsg!.payload.sessions.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Session event forwarding
  // -----------------------------------------------------------------------

  describe('session event forwarding', () => {
    it('forwards all session events to HQ', async () => {
      await manager.start();

      await manager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-6' },
      });

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-sdk-session-event' &&
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
        (m) => m.type === 'copilot-sdk-session-event' && m.payload.sessionId === sessionId,
      );

      expect(forwarded.length).toBeGreaterThan(3); // multiple events: start, delta, tool, message, idle
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

      // No copilot messages should be sent
      const copilotMessages = sent.filter((m) => m.type.startsWith('copilot-'));
      expect(copilotMessages).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Default adapter (SDK) when no adapter option provided
  // -----------------------------------------------------------------------

  describe('default adapter', () => {
    it('creates SdkCopilotAdapter when no adapter option is given', () => {
      const defaultManager = new CopilotManager({
        sendToHq,
        pollIntervalMs: 60_000,
      });

      // The adapter is an SdkCopilotAdapter — state starts as disconnected
      expect(defaultManager.adapterState).toBe('disconnected');
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
        adapter: new TestCopilotAdapter(),
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

      // Session should start successfully (tools injected without error)
      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-sdk-session-event' &&
          m.payload.event.type === 'session.start',
      );
      expect(startEvent).toBeDefined();
      expect(startEvent!.payload.event.data.requestId).toBe('req-hq-1');
    });

    it('injects HQ tools when resuming a session', async () => {
      await managerWithProject.start();
      sent = [];

      await managerWithProject.handleMessage({
        type: 'copilot-resume-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-hq-2', sessionId: 'test-session-001' },
      });

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-sdk-session-event' &&
          m.payload.event.type === 'session.start',
      );
      expect(startEvent).toBeDefined();
      expect(startEvent!.payload.event.data.resumed).toBe(true);
    });

    it('sends tool invocation messages to HQ when tool handlers are called', async () => {
      await managerWithProject.start();

      // Create a session to get the tools injected
      await managerWithProject.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'req-hq-3' },
      });

      sent = [];

      // Simulate calling the HQ tools directly (as the copilot agent would)
      // We use createHqTools to get tool handlers
      const { createHqTools } = await import('../hq-tools.js');
      const tools = createHqTools(sendToHq, 'test-project');

      const progressTool = tools.find((t) => t.name === 'report_progress')!;
      await progressTool.handler({ status: 'working', summary: 'Making progress' });

      const invocationMsg = sent.find((m) => m.type === 'copilot-tool-invocation');
      expect(invocationMsg).toBeDefined();
    });
  });
});
