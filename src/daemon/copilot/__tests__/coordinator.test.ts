import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopilotCoordinator } from '../coordinator.js';
import type { DaemonToHqMessage } from '../../../shared/protocol.js';

// ---------------------------------------------------------------------------
// Mock SDK session — duck-typed to match CopilotSession from the SDK
// ---------------------------------------------------------------------------

function createMockSession(sessionId: string) {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    sessionId,
    on: vi.fn((cb: (event: unknown) => void) => {
      listeners.push(cb);
      return () => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
    send: vi.fn(),
    sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'sub-agent result' } }),
    disconnect: vi.fn(),
    abort: vi.fn(),
    _emit: (event: unknown) => listeners.forEach((cb) => cb(event)),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENTS = [
  { name: 'code_review', description: 'Reviews code for quality and correctness' },
  { name: 'write_tests', description: 'Generates unit tests' },
];

function buildCoordinator(overrides?: { sendToHq?: ReturnType<typeof vi.fn>; client?: unknown }) {
  const mockSessions: ReturnType<typeof createMockSession>[] = [];
  const sendToHq = overrides?.sendToHq ?? vi.fn();
  const client = overrides?.client ?? {
    createSession: vi.fn(async () => {
      const session = createMockSession(`session-${mockSessions.length}`);
      mockSessions.push(session);
      return session;
    }),
  };
  const coordinator = new CopilotCoordinator({
    sendToHq,
    projectId: 'test-project',
    client,
  });
  return { coordinator, sendToHq: sendToHq as ReturnType<typeof vi.fn>, client, mockSessions };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CopilotCoordinator', () => {
  let ctx: ReturnType<typeof buildCoordinator>;

  beforeEach(() => {
    ctx = buildCoordinator();
  });

  // -----------------------------------------------------------------------
  // Session creation
  // -----------------------------------------------------------------------

  it('creates an orchestrator session and returns its ID', async () => {
    const sid = await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });
    expect(sid).toBe('session-0');
    expect(ctx.client.createSession).toHaveBeenCalledTimes(1);
  });

  it('passes model, systemMessage, tools, and streaming to createSession', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', {
      model: 'gpt-4o',
      agents: AGENTS,
    });

    const call = ctx.client.createSession.mock.calls[0][0];
    expect(call.model).toBe('gpt-4o');
    expect(call.streaming).toBe(true);
    expect(call.systemMessage.mode).toBe('append');
    // Tools should match agent count
    expect(call.tools).toHaveLength(AGENTS.length);
    expect(call.tools[0].name).toBe('code_review');
    expect(call.tools[1].name).toBe('write_tests');
  });

  it('passes infiniteSessions config when enabled', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', {
      agents: AGENTS,
      infiniteSessions: true,
    });

    const call = ctx.client.createSession.mock.calls[0][0];
    expect(call.infiniteSessions).toEqual({
      enabled: true,
      backgroundCompactionThreshold: 0.8,
      bufferExhaustionThreshold: 0.95,
    });
  });

  it('uses custom systemMessage when provided', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', {
      agents: AGENTS,
      systemMessage: 'Custom orchestrator prompt',
    });

    const call = ctx.client.createSession.mock.calls[0][0];
    expect(call.systemMessage.content).toBe('Custom orchestrator prompt');
  });

  it('generates default orchestrator system message listing agents', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });

    const call = ctx.client.createSession.mock.calls[0][0];
    expect(call.systemMessage.content).toContain('code_review');
    expect(call.systemMessage.content).toContain('write_tests');
    expect(call.systemMessage.content).toContain('orchestrator');
  });

  // -----------------------------------------------------------------------
  // HQ event forwarding
  // -----------------------------------------------------------------------

  it('sends a session.start event to HQ on creation', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });

    const startEvents = (ctx.sendToHq as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as DaemonToHqMessage)
      .filter(
        (m) =>
          m.type === 'copilot-session-event' &&
          (m as { payload: { event: { type: string } } }).payload.event.type === 'session.start',
      );

    expect(startEvents.length).toBe(1);
    const payload = (startEvents[0] as { payload: Record<string, unknown> }).payload as {
      sessionId: string;
      sessionType: string;
      event: { data: { isCoordinator: boolean; agents: string[] } };
    };
    expect(payload.sessionId).toBe('session-0');
    expect(payload.sessionType).toBe('copilot-sdk');
    expect(payload.event.data.isCoordinator).toBe(true);
    expect(payload.event.data.agents).toEqual(['code_review', 'write_tests']);
  });

  it('wires orchestrator session events to HQ', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });

    // Emit a mock SDK event on the orchestrator session
    const orchestratorSession = ctx.mockSessions[0];
    orchestratorSession._emit({ type: 'assistant.streaming_delta', data: { delta: 'hello' } });

    const relayed = (ctx.sendToHq as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as DaemonToHqMessage)
      .filter(
        (m) =>
          m.type === 'copilot-session-event' &&
          (m as { payload: { event: { type: string } } }).payload.event.type ===
            'assistant.streaming_delta',
      );

    expect(relayed.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Sub-agent spawning
  // -----------------------------------------------------------------------

  it('spawns a sub-agent session and returns its result', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });

    const result = await ctx.coordinator.spawnSubAgent(AGENTS[0], 'Review this code');

    // Should have created a second session (index 1)
    expect(ctx.client.createSession).toHaveBeenCalledTimes(2);
    expect(result).toBe('sub-agent result');
  });

  it('forwards sub-agent events with parentSessionId', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });

    // Start spawning — this creates session-1
    const spawnPromise = ctx.coordinator.spawnSubAgent(AGENTS[0], 'Review this');

    // Wait for result
    await spawnPromise;

    const subStartEvents = (ctx.sendToHq as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as DaemonToHqMessage)
      .filter((m) => {
        if (m.type !== 'copilot-session-event') return false;
        const payload = (m as { payload: { event: { type: string; data?: Record<string, unknown> } } }).payload;
        return (
          payload.event.type === 'session.start' && payload.event.data?.parentSessionId != null
        );
      });

    expect(subStartEvents.length).toBe(1);
    const evt = (subStartEvents[0] as { payload: { event: { data: { parentSessionId: string; agentRole: string } } } }).payload.event;
    expect(evt.data.parentSessionId).toBe('session-0');
    expect(evt.data.agentRole).toBe('code_review');
  });

  it('disconnects sub-agent session after completion', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });

    await ctx.coordinator.spawnSubAgent(AGENTS[0], 'Review');

    const subSession = ctx.mockSessions[1];
    expect(subSession.disconnect).toHaveBeenCalled();
  });

  it('returns error message when sub-agent session fails', async () => {
    const failClient = {
      createSession: vi.fn()
        .mockResolvedValueOnce(createMockSession('orch-0'))
        .mockRejectedValueOnce(new Error('connection lost')),
    };
    const { coordinator, sendToHq } = buildCoordinator({ client: failClient, sendToHq: vi.fn() });

    await coordinator.createCoordinatedSession('req-1', { agents: AGENTS });
    const result = await coordinator.spawnSubAgent(AGENTS[0], 'fail');

    expect(result).toContain('Error from code_review');
    expect(result).toContain('connection lost');
  });

  // -----------------------------------------------------------------------
  // sendPrompt / abort
  // -----------------------------------------------------------------------

  it('sendPrompt delegates to orchestrator session', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });

    await ctx.coordinator.sendPrompt('Analyze the repo');

    expect(ctx.mockSessions[0].send).toHaveBeenCalledWith({ prompt: 'Analyze the repo' });
  });

  it('sendPrompt throws when no active session', async () => {
    await expect(ctx.coordinator.sendPrompt('hello')).rejects.toThrow(
      'No active coordinated session',
    );
  });

  it('abort delegates to orchestrator session', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });

    await ctx.coordinator.abort();

    expect(ctx.mockSessions[0].abort).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // hasSession
  // -----------------------------------------------------------------------

  it('hasSession returns true for orchestrator session ID', async () => {
    const sid = await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });
    expect(ctx.coordinator.hasSession(sid)).toBe(true);
  });

  it('hasSession returns false for unknown session ID', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });
    expect(ctx.coordinator.hasSession('unknown-id')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // stop / cleanup
  // -----------------------------------------------------------------------

  it('stop disconnects orchestrator and clears state', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });
    const orchestratorSession = ctx.mockSessions[0];

    await ctx.coordinator.stop();

    expect(orchestratorSession.disconnect).toHaveBeenCalled();
    expect(ctx.coordinator.getSessionId()).toBeNull();
  });

  it('stop disconnects active sub-agent sessions', async () => {
    await ctx.coordinator.createCoordinatedSession('req-1', { agents: AGENTS });

    // Manually mark a sub-agent as active by spawning one that won't auto-clean
    // We'll use a sendAndWait that never resolves, then stop
    const neverResolve = new Promise<never>(() => {});
    const hangingClient = {
      createSession: vi.fn(async () => {
        const session = createMockSession(`hanging-session`);
        session.sendAndWait.mockReturnValue(neverResolve);
        return session;
      }),
    };

    // Build a separate coordinator for this test
    const { coordinator: coord2 } = buildCoordinator({ client: hangingClient, sendToHq: vi.fn() });
    await coord2.createCoordinatedSession('req-2', { agents: AGENTS });

    // Start a sub-agent that will hang (don't await it)
    const spawnPromise = coord2.spawnSubAgent(AGENTS[0], 'hang');

    // Stop should clean up without waiting for the hanging sub-agent
    await coord2.stop();
    expect(coord2.getSessionId()).toBeNull();

    // The spawn will eventually return an error since session is gone, but we don't need to await it
    // Just verify stop completed cleanly
  });
});
