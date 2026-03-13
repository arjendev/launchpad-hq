/**
 * Mock Copilot SDK adapter for development.
 *
 * Simulates realistic session behaviour so the daemon ↔ HQ pipeline
 * can be exercised end-to-end without the real @github/copilot-sdk.
 */

import { randomUUID } from 'node:crypto';
import type {
  CopilotSdkSessionInfo,
  CopilotSessionEvent,
  CopilotSdkState,
  CopilotAdapter,
  CopilotSession,
  SessionConfig,
} from './adapter.js';

// ---------------------------------------------------------------------------
// Mock session
// ---------------------------------------------------------------------------

class MockCopilotSession implements CopilotSession {
  readonly sessionId: string;
  private handlers: Array<(event: CopilotSessionEvent) => void> = [];
  private events: CopilotSessionEvent[] = [];
  private aborted = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async send(options: {
    prompt: string;
    attachments?: Array<{ type: string; path: string }>;
  }): Promise<string> {
    this.aborted = false;
    const words = `Here is a mock response to: "${options.prompt}"`.split(' ');

    // Emit session.start
    this.emit({ type: 'session.start', data: {}, timestamp: Date.now() });

    // Emit user.message
    this.emit({
      type: 'user.message',
      data: { content: options.prompt },
      timestamp: Date.now(),
    });

    // Simulate streaming deltas
    for (let i = 0; i < words.length; i++) {
      await this.delay(30);
      if (this.aborted) return '';
      this.emit({
        type: 'assistant.message.delta',
        data: { delta: words[i] + ' ' },
        timestamp: Date.now(),
      });
    }

    const fullResponse = words.join(' ');

    // Simulate a tool call midway
    this.emit({
      type: 'tool.executionStart',
      data: { tool: 'file_search', args: { query: options.prompt } },
      timestamp: Date.now(),
    });

    await this.delay(50);
    if (this.aborted) return '';

    this.emit({
      type: 'tool.executionComplete',
      data: { tool: 'file_search', result: 'found 3 matches' },
      timestamp: Date.now(),
    });

    // Final assistant message
    this.emit({
      type: 'assistant.message',
      data: { content: fullResponse },
      timestamp: Date.now(),
    });

    // Session goes idle
    this.emit({ type: 'session.idle', data: {}, timestamp: Date.now() });

    return fullResponse;
  }

  private abortResolvers: Array<() => void> = [];

  async abort(): Promise<void> {
    this.aborted = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const resolve of this.abortResolvers) resolve();
    this.abortResolvers = [];
  }

  async getMessages(): Promise<CopilotSessionEvent[]> {
    return [...this.events];
  }

  on(handler: (event: CopilotSessionEvent) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async destroy(): Promise<void> {
    await this.abort();
    this.handlers = [];
  }

  // -- internal helpers --

  private emit(event: CopilotSessionEvent): void {
    this.events.push(event);
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.timers.push(t);
      this.abortResolvers.push(resolve);
    });
  }
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

const MOCK_SESSIONS: CopilotSdkSessionInfo[] = [
  {
    sessionId: 'mock-session-001',
    cwd: '/workspaces/launchpad',
    gitRoot: '/workspaces/launchpad',
    repository: 'launchpad-hq/launchpad',
    branch: 'main',
    summary: 'Refactoring daemon WebSocket client',
  },
  {
    sessionId: 'mock-session-002',
    cwd: '/workspaces/launchpad',
    gitRoot: '/workspaces/launchpad',
    repository: 'launchpad-hq/launchpad',
    branch: 'feat/copilot-sdk',
    summary: 'Implementing Copilot SDK integration layer',
  },
  {
    sessionId: 'mock-session-003',
    repository: 'launchpad-hq/launchpad',
    branch: 'main',
    summary: 'Debugging terminal resize events',
  },
];

export class MockCopilotAdapter implements CopilotAdapter {
  private _state: CopilotSdkState = 'disconnected';
  private stateHandlers: Array<(state: CopilotSdkState) => void> = [];
  private sessions = new Map<string, MockCopilotSession>();
  private lastSessionId: string | null = null;

  get state(): CopilotSdkState {
    return this._state;
  }

  async start(): Promise<void> {
    this.setState('connecting');
    // Simulate async connect
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    this.setState('connected');
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.destroy();
    }
    this.sessions.clear();
    this.setState('disconnected');
  }

  async listSessions(): Promise<CopilotSdkSessionInfo[]> {
    return [...MOCK_SESSIONS];
  }

  async getLastSessionId(): Promise<string | null> {
    return this.lastSessionId;
  }

  async createSession(_config: SessionConfig): Promise<CopilotSession> {
    const id = `mock-${randomUUID().slice(0, 8)}`;
    const session = new MockCopilotSession(id);
    this.sessions.set(id, session);
    this.lastSessionId = id;
    return session;
  }

  async resumeSession(
    sessionId: string,
    _config?: Partial<SessionConfig>,
  ): Promise<CopilotSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    // Create a new session under the requested id
    const session = new MockCopilotSession(sessionId);
    this.sessions.set(sessionId, session);
    this.lastSessionId = sessionId;
    return session;
  }

  onStateChange(handler: (state: CopilotSdkState) => void): () => void {
    this.stateHandlers.push(handler);
    return () => {
      this.stateHandlers = this.stateHandlers.filter((h) => h !== handler);
    };
  }

  private setState(next: CopilotSdkState): void {
    this._state = next;
    for (const handler of this.stateHandlers) {
      handler(next);
    }
  }
}
