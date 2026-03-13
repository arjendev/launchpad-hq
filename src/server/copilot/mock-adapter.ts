// ────────────────────────────────────────────────────────
// Mock Copilot adapter — realistic session simulation
//
// MOCKED: Everything in this file is simulated. No real
// Copilot SDK calls are made. This exists so frontend
// development can proceed before the SDK is available.
//
// EXTENSION POINT: Replace this adapter with a real SDK
// adapter when @github/copilot-sdk ships. The interface
// contract (CopilotAdapter) stays the same.
// ────────────────────────────────────────────────────────

import type {
  CopilotAdapter,
  CopilotSession,
  CopilotSessionSummary,
  ConversationMessage,
  SessionChangeEvent,
  SessionStatus,
} from "./types.js";

// ── Seed data ────────────────────────────────────────────

function makeId(): string {
  return `cps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeMessageId(): string {
  return `msg_${Math.random().toString(36).slice(2, 10)}`;
}

const MOCK_REPOS = [
  "arjendev/launchpad-hq",
  "arjendev/data-pipeline",
  "arjendev/infra-modules",
];

const MOCK_TASKS = [
  "Implementing authentication middleware",
  "Refactoring database queries for performance",
  "Adding unit tests for the payment module",
  "Fixing CSS layout issues on the dashboard",
  "Writing API documentation",
  null, // idle session — no task
];

const MOCK_CONVERSATIONS: ConversationMessage[][] = [
  [
    { id: makeMessageId(), role: "user", content: "Help me add JWT authentication to the Express server", timestamp: new Date(Date.now() - 300_000).toISOString() },
    { id: makeMessageId(), role: "assistant", content: "I'll help you set up JWT authentication. Let me start by installing the required packages and creating the middleware.", timestamp: new Date(Date.now() - 295_000).toISOString() },
    { id: makeMessageId(), role: "user", content: "Also add refresh token rotation", timestamp: new Date(Date.now() - 120_000).toISOString() },
    { id: makeMessageId(), role: "assistant", content: "Good call. I'll implement refresh token rotation with a token family tracking approach to detect reuse.", timestamp: new Date(Date.now() - 115_000).toISOString() },
  ],
  [
    { id: makeMessageId(), role: "user", content: "The dashboard page is loading slowly. Can you optimize the database queries?", timestamp: new Date(Date.now() - 600_000).toISOString() },
    { id: makeMessageId(), role: "assistant", content: "Let me analyze the current queries. I see several N+1 query patterns that we can batch.", timestamp: new Date(Date.now() - 595_000).toISOString() },
  ],
  [
    { id: makeMessageId(), role: "user", content: "Write tests for the PaymentService class", timestamp: new Date(Date.now() - 180_000).toISOString() },
    { id: makeMessageId(), role: "assistant", content: "I'll create comprehensive tests covering successful payments, declined cards, refunds, and edge cases.", timestamp: new Date(Date.now() - 175_000).toISOString() },
    { id: makeMessageId(), role: "user", content: "Make sure to mock the Stripe API", timestamp: new Date(Date.now() - 60_000).toISOString() },
    { id: makeMessageId(), role: "assistant", content: "Absolutely — I'll use vi.mock for the Stripe client and create typed fixtures for common responses.", timestamp: new Date(Date.now() - 55_000).toISOString() },
  ],
];

// ── Mock session store ───────────────────────────────────

function createMockSessions(): Map<string, CopilotSession> {
  const sessions = new Map<string, CopilotSession>();
  const statuses: SessionStatus[] = ["active", "active", "idle"];

  for (let i = 0; i < 3; i++) {
    const id = makeId();
    sessions.set(id, {
      id,
      status: statuses[i],
      startedAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
      repository: MOCK_REPOS[i],
      currentTask: MOCK_TASKS[i],
      conversationHistory: MOCK_CONVERSATIONS[i] ?? [],
      adapter: "mock",
    });
  }

  return sessions;
}

// ── Adapter implementation ───────────────────────────────

export interface MockAdapterOptions {
  /** Interval (ms) between simulated session change events. 0 to disable. */
  updateIntervalMs?: number;
}

export class MockCopilotAdapter implements CopilotAdapter {
  private sessions: Map<string, CopilotSession>;
  private timers: ReturnType<typeof setInterval>[] = [];
  private disposed = false;

  constructor(private readonly options: MockAdapterOptions = {}) {
    this.sessions = createMockSessions();
  }

  async listSessions(): Promise<CopilotSessionSummary[]> {
    return [...this.sessions.values()].map(toSummary);
  }

  async getSession(id: string): Promise<CopilotSession | null> {
    return this.sessions.get(id) ?? null;
  }

  startWatching(onChange: (event: SessionChangeEvent) => void): () => void {
    const interval = this.options.updateIntervalMs ?? 30_000;
    if (interval <= 0 || this.disposed) return () => {};

    const timer = setInterval(() => {
      if (this.disposed) return;
      const event = this.simulateChange();
      if (event) onChange(event);
    }, interval);

    this.timers.push(timer);

    return () => {
      clearInterval(timer);
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  // ── Simulation logic ────────────────────────────────

  private simulateChange(): SessionChangeEvent | null {
    const roll = Math.random();

    if (roll < 0.3) {
      // Add a new session
      return this.simulateNewSession();
    } else if (roll < 0.7) {
      // Update an existing session
      return this.simulateUpdate();
    } else {
      // Complete a session
      return this.simulateCompletion();
    }
  }

  private simulateNewSession(): SessionChangeEvent {
    const id = makeId();
    const repo = MOCK_REPOS[Math.floor(Math.random() * MOCK_REPOS.length)];
    const task = MOCK_TASKS[Math.floor(Math.random() * MOCK_TASKS.length)];

    const session: CopilotSession = {
      id,
      status: "active",
      startedAt: new Date().toISOString(),
      repository: repo,
      currentTask: task,
      conversationHistory: [
        {
          id: makeMessageId(),
          role: "user",
          content: task ?? "Start a new coding session",
          timestamp: new Date().toISOString(),
        },
      ],
      adapter: "mock",
    };

    this.sessions.set(id, session);

    return {
      type: "session:created",
      session: toSummary(session),
      timestamp: new Date().toISOString(),
    };
  }

  private simulateUpdate(): SessionChangeEvent | null {
    const active = [...this.sessions.values()].filter(
      (s) => s.status === "active",
    );
    if (active.length === 0) return null;

    const session = active[Math.floor(Math.random() * active.length)];
    session.conversationHistory.push({
      id: makeMessageId(),
      role: "assistant",
      content: "Working on the next step...",
      timestamp: new Date().toISOString(),
    });

    return {
      type: "session:updated",
      session: toSummary(session),
      timestamp: new Date().toISOString(),
    };
  }

  private simulateCompletion(): SessionChangeEvent | null {
    const active = [...this.sessions.values()].filter(
      (s) => s.status === "active" || s.status === "idle",
    );
    if (active.length === 0) return null;

    const session = active[Math.floor(Math.random() * active.length)];
    session.status = "completed";
    session.currentTask = null;

    return {
      type: "session:updated",
      session: toSummary(session),
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Helpers ──────────────────────────────────────────────

function toSummary(session: CopilotSession): CopilotSessionSummary {
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt,
    repository: session.repository,
    currentTask: session.currentTask,
    messageCount: session.conversationHistory.length,
    adapter: session.adapter,
  };
}
