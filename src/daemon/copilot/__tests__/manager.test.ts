import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CopilotManager } from '../manager.js';
import type { DaemonToHqMessage, HqToDaemonMessage } from '../../../shared/protocol.js';
import type { CopilotSessionEvent } from '../adapter.js';

describe('CopilotManager', () => {
  let manager: CopilotManager;
  let sent: DaemonToHqMessage[];
  const sendToHq = (msg: DaemonToHqMessage) => sent.push(msg);

  beforeEach(() => {
    sent = [];
    manager = new CopilotManager({
      sendToHq,
      useMock: true,
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
        payload: { requestId: 'req-2', sessionId: 'mock-session-001' },
      };

      await manager.handleMessage(msg);

      const startEvent = sent.find(
        (m) =>
          m.type === 'copilot-sdk-session-event' &&
          m.payload.event.type === 'session.start',
      );
      expect(startEvent).toBeDefined();
      expect(startEvent!.payload.event.data.resumed).toBe(true);
      expect(startEvent!.payload.sessionId).toBe('mock-session-001');
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
  // Auto-fallback to mock when SDK is unavailable
  // -----------------------------------------------------------------------

  describe('auto-fallback to mock when SDK unavailable', () => {
    it('falls back to mock adapter when useMock=false and SDK is not available', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fallbackManager = new CopilotManager({
        sendToHq,
        useMock: false,
        pollIntervalMs: 60_000,
      });

      // Should not throw — uses mock adapter internally
      await fallbackManager.start();
      expect(fallbackManager.adapterState).toBe('connected');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to mock'),
      );

      await fallbackManager.stop();
      warnSpy.mockRestore();
    });

    it('auto-fallback manager still handles commands', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fallbackSent: DaemonToHqMessage[] = [];
      const fallbackManager = new CopilotManager({
        sendToHq: (msg) => fallbackSent.push(msg),
        useMock: false,
        pollIntervalMs: 60_000,
      });

      await fallbackManager.start();

      await fallbackManager.handleMessage({
        type: 'copilot-create-session',
        timestamp: Date.now(),
        payload: { requestId: 'fb-1' },
      });

      const startEvent = fallbackSent.find(
        (m) =>
          m.type === 'copilot-sdk-session-event' &&
          m.payload.event.type === 'session.start',
      );
      expect(startEvent).toBeDefined();

      await fallbackManager.stop();
      vi.restoreAllMocks();
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
        useMock: true,
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
        payload: { requestId: 'req-hq-2', sessionId: 'mock-session-001' },
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
