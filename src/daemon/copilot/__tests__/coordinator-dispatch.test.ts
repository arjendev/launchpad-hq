import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CoordinatorSessionManager } from '../coordinator.js';
import { IssueDispatcher } from '../dispatch.js';
import type {
  CoordinatorStatus,
  DaemonToHqMessage,
  WorkflowIssuePayload,
} from '../../../shared/protocol.js';

// ---------------------------------------------------------------------------
// Mock CopilotManager — duck-typed for coordinator + dispatch usage
// ---------------------------------------------------------------------------

class MockCopilotManager {
  createdSessions: string[] = [];
  resumedSessions: string[] = [];
  sentPrompts: Array<{ sessionId: string; prompt: string }> = [];
  createError: Error | null = null;
  resumeError: Error | null = null;
  sendError: Error | null = null;
  isReady = true;
  private nextId = 0;

  async createCoordinatorSession(opts: {
    requestId: string;
    systemMessage: { mode: string; content: string };
  }): Promise<string> {
    if (this.createError) throw this.createError;
    const id = `coord-session-${this.nextId++}`;
    this.createdSessions.push(id);
    return id;
  }

  async resumeCoordinatorSession(opts: {
    requestId: string;
    sessionId: string;
    systemMessage: { mode: string; content: string };
  }): Promise<void> {
    if (this.resumeError) throw this.resumeError;
    this.resumedSessions.push(opts.sessionId);
  }

  async sendToSession(sessionId: string, prompt: string): Promise<boolean> {
    if (this.sendError) throw this.sendError;
    this.sentPrompts.push({ sessionId, prompt });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCoordinator(
  overrides: {
    sendToHq?: (msg: DaemonToHqMessage) => void;
    copilotManager?: MockCopilotManager;
    healthIntervalMs?: number;
    maxBackoffMs?: number;
  } = {},
) {
  const sent: DaemonToHqMessage[] = [];
  const sendToHq = overrides.sendToHq ?? ((msg: DaemonToHqMessage) => sent.push(msg));
  const mockManager = overrides.copilotManager ?? new MockCopilotManager();

  const coordinator = new CoordinatorSessionManager({
    sendToHq,
    copilotManager: mockManager as never,
    projectId: 'test-project',
    projectName: 'Test Project',
    healthIntervalMs: overrides.healthIntervalMs ?? 60_000,
    maxBackoffMs: overrides.maxBackoffMs ?? 30_000,
  });

  return { coordinator, sent, mockManager };
}

function sampleIssue(overrides: Partial<WorkflowIssuePayload> = {}): WorkflowIssuePayload {
  return {
    issueNumber: 42,
    title: 'Fix auth timeout',
    body: 'Users are seeing auth timeouts after 5 minutes.',
    labels: ['bug', 'auth'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CoordinatorSessionManager tests
// ---------------------------------------------------------------------------

describe('CoordinatorSessionManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('start()', () => {
    it('creates a new session and transitions to active', async () => {
      const { coordinator, sent } = createCoordinator();

      await coordinator.start();

      expect(coordinator.state).toBe('active');
      expect(coordinator.sessionId).toMatch(/^coord-session-/);

      const started = sent.find((m) => m.type === 'workflow:coordinator-started');
      expect(started).toBeDefined();
      expect(started!.payload.resumed).toBe(false);
      expect(started!.payload.sessionId).toBe(coordinator.sessionId);

      await coordinator.stop();
    });

    it('resumes an existing session when sessionId provided', async () => {
      const { coordinator, sent, mockManager } = createCoordinator();

      await coordinator.start('existing-session-123');

      expect(coordinator.state).toBe('active');
      expect(coordinator.sessionId).toBe('existing-session-123');
      expect(mockManager.resumedSessions).toContain('existing-session-123');

      const started = sent.find((m) => m.type === 'workflow:coordinator-started');
      expect(started!.payload.resumed).toBe(true);

      await coordinator.stop();
    });

    it('is idempotent when already active', async () => {
      const { coordinator, mockManager } = createCoordinator();

      await coordinator.start();
      const firstSessionId = coordinator.sessionId;
      await coordinator.start(); // should no-op

      expect(coordinator.sessionId).toBe(firstSessionId);
      expect(mockManager.createdSessions).toHaveLength(1);

      await coordinator.stop();
    });
  });

  describe('stop()', () => {
    it('transitions to stopped and preserves sessionId for resume', async () => {
      const { coordinator } = createCoordinator();

      await coordinator.start();
      expect(coordinator.state).toBe('active');
      const sessionId = coordinator.sessionId;

      await coordinator.stop();
      expect(coordinator.state).toBe('stopped');
      expect(coordinator.sessionId).toBe(sessionId);
    });
  });

  describe('crash and auto-restart', () => {
    it('sends crash notification and schedules restart on create failure', async () => {
      vi.useFakeTimers();
      const mockManager = new MockCopilotManager();
      mockManager.createError = new Error('SDK connection lost');

      const { coordinator, sent } = createCoordinator({
        copilotManager: mockManager,
        maxBackoffMs: 30_000,
      });

      await coordinator.start();

      expect(coordinator.state).toBe('crashed');

      const crashed = sent.find((m) => m.type === 'workflow:coordinator-crashed');
      expect(crashed).toBeDefined();
      expect(crashed!.payload.error).toContain('SDK connection lost');
      expect(crashed!.payload.willRetry).toBe(true);
      expect(crashed!.payload.retryAttempt).toBe(1);

      // Allow the backoff timer to expire and retry
      mockManager.createError = null; // next attempt succeeds
      await vi.advanceTimersByTimeAsync(1_000);

      expect(coordinator.state).toBe('active');
      expect(coordinator.status.restartCount).toBe(1);

      await coordinator.stop();
      vi.useRealTimers();
    });

    it('uses exponential backoff: 1s, 2s, 4s, 8s', async () => {
      vi.useFakeTimers();
      const mockManager = new MockCopilotManager();
      mockManager.createError = new Error('fail');

      const { coordinator } = createCoordinator({
        copilotManager: mockManager,
        maxBackoffMs: 30_000,
      });

      await coordinator.start();
      expect(coordinator.state).toBe('crashed');

      // First backoff = 1s
      expect(coordinator.getBackoffDelay()).toBe(1_000);

      // Advance 1s — retries and fails again
      await vi.advanceTimersByTimeAsync(1_000);
      expect(coordinator.state).toBe('crashed');

      // Second backoff = 2s
      expect(coordinator.getBackoffDelay()).toBe(2_000);

      // Advance 2s — retries and fails again
      await vi.advanceTimersByTimeAsync(2_000);
      expect(coordinator.state).toBe('crashed');

      // Third backoff = 4s
      expect(coordinator.getBackoffDelay()).toBe(4_000);

      await coordinator.stop();
      vi.useRealTimers();
    });

    it('caps backoff at maxBackoffMs', async () => {
      vi.useFakeTimers();
      const mockManager = new MockCopilotManager();
      mockManager.createError = new Error('fail');

      const { coordinator } = createCoordinator({
        copilotManager: mockManager,
        maxBackoffMs: 5_000,
      });

      // Trigger multiple failures to push backoff beyond cap
      await coordinator.start(); // fail 1 → backoff 1s
      await vi.advanceTimersByTimeAsync(1_000); // fail 2 → backoff 2s
      await vi.advanceTimersByTimeAsync(2_000); // fail 3 → backoff 4s
      await vi.advanceTimersByTimeAsync(4_000); // fail 4 → backoff 5s (capped)

      expect(coordinator.getBackoffDelay()).toBe(5_000);

      await coordinator.stop();
      vi.useRealTimers();
    });

    it('does not retry after stop()', async () => {
      vi.useFakeTimers();
      const mockManager = new MockCopilotManager();
      mockManager.createError = new Error('fail');

      const { coordinator, sent } = createCoordinator({ copilotManager: mockManager });

      await coordinator.start();
      expect(coordinator.state).toBe('crashed');

      await coordinator.stop();
      expect(coordinator.state).toBe('stopped');

      // Advance timers — no restart should happen
      mockManager.createError = null;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(coordinator.state).toBe('stopped');

      vi.useRealTimers();
    });
  });

  describe('health monitoring', () => {
    it('sends periodic health heartbeats', async () => {
      vi.useFakeTimers();
      const { coordinator, sent } = createCoordinator({ healthIntervalMs: 1_000 });

      await coordinator.start();
      sent.length = 0;

      await vi.advanceTimersByTimeAsync(1_000);

      const health = sent.filter((m) => m.type === 'workflow:coordinator-health');
      expect(health.length).toBeGreaterThanOrEqual(1);
      expect(health[0].payload.state).toBe('active');
      expect(health[0].payload.sessionId).toBe(coordinator.sessionId);
      expect(health[0].payload.uptimeMs).toBeGreaterThan(0);

      await coordinator.stop();
      vi.useRealTimers();
    });

    it('stops health heartbeats after stop()', async () => {
      vi.useFakeTimers();
      const { coordinator, sent } = createCoordinator({ healthIntervalMs: 1_000 });

      await coordinator.start();
      await coordinator.stop();
      sent.length = 0;

      await vi.advanceTimersByTimeAsync(5_000);

      const health = sent.filter((m) => m.type === 'workflow:coordinator-health');
      expect(health).toHaveLength(0);

      vi.useRealTimers();
    });
  });

  describe('status snapshot', () => {
    it('reports correct dispatch/completion counts', async () => {
      const { coordinator } = createCoordinator();
      await coordinator.start();

      coordinator.recordDispatch();
      coordinator.recordDispatch();
      coordinator.recordCompletion();

      const status = coordinator.status;
      expect(status.dispatched).toBe(2);
      expect(status.completed).toBe(1);
      expect(status.state).toBe('active');

      await coordinator.stop();
    });
  });

  describe('progress event forwarding', () => {
    it('sends workflow:progress for a given issue', async () => {
      const { coordinator, sent } = createCoordinator();
      await coordinator.start();
      sent.length = 0;

      const mockEvent = {
        id: 'evt-1',
        timestamp: new Date().toISOString(),
        parentId: null,
        type: 'tool.execution_start',
        data: { tool: 'edit' },
      } as never;

      coordinator.forwardProgressEvent(42, mockEvent);

      const progress = sent.find((m) => m.type === 'workflow:progress');
      expect(progress).toBeDefined();
      expect(progress!.payload.issueNumber).toBe(42);
      expect(progress!.payload.sessionId).toBe(coordinator.sessionId);

      await coordinator.stop();
    });
  });
});

// ---------------------------------------------------------------------------
// IssueDispatcher tests
// ---------------------------------------------------------------------------

describe('IssueDispatcher', () => {
  let coordinator: CoordinatorSessionManager;
  let mockManager: MockCopilotManager;
  let sent: DaemonToHqMessage[];
  let dispatcher: IssueDispatcher;

  beforeEach(async () => {
    const ctx = createCoordinator();
    coordinator = ctx.coordinator;
    mockManager = ctx.mockManager;
    sent = ctx.sent;

    await coordinator.start();
    sent.length = 0;
    mockManager.sentPrompts.length = 0; // Clear initial ping from createSession

    dispatcher = new IssueDispatcher({
      sendToHq: (msg) => sent.push(msg),
      copilotManager: mockManager as never,
      coordinator,
      projectId: 'test-project',
    });
  });

  afterEach(async () => {
    await coordinator.stop();
  });

  describe('dispatchIssue()', () => {
    it('sends formatted prompt to coordinator session', async () => {
      const issue = sampleIssue();
      const result = await dispatcher.dispatchIssue(issue);

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe(coordinator.sessionId);

      expect(mockManager.sentPrompts).toHaveLength(1);
      const prompt = mockManager.sentPrompts[0].prompt;
      expect(prompt).toContain('Issue #42');
      expect(prompt).toContain('Fix auth timeout');
      expect(prompt).toContain('Users are seeing auth timeouts');
      expect(prompt).toContain('bug, auth');
    });

    it('includes feedback in prompt when provided', async () => {
      const issue = sampleIssue({ feedback: 'Tried disabling cache, still fails.' });
      await dispatcher.dispatchIssue(issue);

      const prompt = mockManager.sentPrompts[0].prompt;
      expect(prompt).toContain('Prior Feedback');
      expect(prompt).toContain('Tried disabling cache');
    });

    it('sends workflow:dispatch-started to HQ', async () => {
      await dispatcher.dispatchIssue(sampleIssue());

      const started = sent.find((m) => m.type === 'workflow:dispatch-started');
      expect(started).toBeDefined();
      expect(started!.payload.issueNumber).toBe(42);
      expect(started!.payload.title).toBe('Fix auth timeout');
    });

    it('fails when no active coordinator session', async () => {
      await coordinator.stop();

      const result = await dispatcher.dispatchIssue(sampleIssue());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Coordinator is in state');
    });

    it('fails when coordinator is crashed', async () => {
      // Force coordinator into crashed state by stopping and then
      // triggering a start failure
      await coordinator.stop();

      const result = await dispatcher.dispatchIssue(sampleIssue());
      expect(result.success).toBe(false);
    });

    it('handles sendToSession errors gracefully', async () => {
      mockManager.sendError = new Error('Session disconnected');

      const result = await dispatcher.dispatchIssue(sampleIssue());
      expect(result.success).toBe(false);
      expect(result.error).toContain('Session disconnected');
    });
  });

  describe('markCompleted()', () => {
    it('marks issue as completed and sends workflow:issue-completed', async () => {
      await dispatcher.dispatchIssue(sampleIssue());
      sent.length = 0;

      dispatcher.markCompleted(42, 'Auth timeout fixed by extending token TTL');

      const completed = sent.find((m) => m.type === 'workflow:issue-completed');
      expect(completed).toBeDefined();
      expect(completed!.payload.issueNumber).toBe(42);
      expect(completed!.payload.summary).toContain('extending token TTL');

      const status = dispatcher.getDispatchStatus(42);
      expect(status?.status).toBe('completed');
    });
  });

  describe('markFailed()', () => {
    it('marks issue as failed', async () => {
      await dispatcher.dispatchIssue(sampleIssue());

      dispatcher.markFailed(42);

      const status = dispatcher.getDispatchStatus(42);
      expect(status?.status).toBe('failed');
    });
  });

  describe('tracking', () => {
    it('tracks active dispatch count', async () => {
      const issue1 = sampleIssue({ issueNumber: 1, title: 'Issue 1' });
      const issue2 = sampleIssue({ issueNumber: 2, title: 'Issue 2' });

      await dispatcher.dispatchIssue(issue1);
      await dispatcher.dispatchIssue(issue2);

      expect(dispatcher.activeCount).toBe(2);

      dispatcher.markCompleted(1, 'Done');
      expect(dispatcher.activeCount).toBe(1);
    });

    it('returns all dispatched issues', async () => {
      await dispatcher.dispatchIssue(sampleIssue({ issueNumber: 10, title: 'A' }));
      await dispatcher.dispatchIssue(sampleIssue({ issueNumber: 20, title: 'B' }));

      const all = dispatcher.getAllDispatched();
      expect(all.size).toBe(2);
      expect(all.has(10)).toBe(true);
      expect(all.has(20)).toBe(true);
    });
  });
});
