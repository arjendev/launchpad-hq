import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockCopilotAdapter } from "../mock-adapter.js";
import { CopilotSessionManager } from "../session-manager.js";
import type { SessionChangeEvent } from "../types.js";

// ── MockCopilotAdapter tests ─────────────────────────────

describe("MockCopilotAdapter", () => {
  let adapter: MockCopilotAdapter;

  beforeEach(() => {
    adapter = new MockCopilotAdapter({ updateIntervalMs: 0 });
  });

  afterEach(() => {
    adapter.dispose();
  });

  it("returns initial mock sessions", async () => {
    const sessions = await adapter.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    for (const s of sessions) {
      expect(s).toHaveProperty("id");
      expect(s).toHaveProperty("status");
      expect(s).toHaveProperty("startedAt");
      expect(s).toHaveProperty("adapter", "mock");
      expect(s).toHaveProperty("messageCount");
    }
  });

  it("getSession returns full session with conversation history", async () => {
    const sessions = await adapter.listSessions();
    const first = sessions[0];
    const full = await adapter.getSession(first.id);

    expect(full).not.toBeNull();
    expect(full!.id).toBe(first.id);
    expect(full!.conversationHistory).toBeInstanceOf(Array);
    expect(full!.adapter).toBe("mock");
  });

  it("getSession returns null for unknown id", async () => {
    const result = await adapter.getSession("nonexistent");
    expect(result).toBeNull();
  });

  it("startWatching fires change events on interval", async () => {
    const fastAdapter = new MockCopilotAdapter({ updateIntervalMs: 50 });
    const events: SessionChangeEvent[] = [];

    const stop = fastAdapter.startWatching((event) => {
      events.push(event);
    });

    // Wait for at least one tick
    await new Promise((resolve) => setTimeout(resolve, 200));

    stop();
    fastAdapter.dispose();

    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const event of events) {
      expect(event).toHaveProperty("type");
      expect(event).toHaveProperty("session");
      expect(event).toHaveProperty("timestamp");
      expect(["session:created", "session:updated", "session:removed"]).toContain(event.type);
    }
  });

  it("dispose stops all timers", async () => {
    const events: SessionChangeEvent[] = [];
    adapter = new MockCopilotAdapter({ updateIntervalMs: 50 });
    adapter.startWatching((event) => events.push(event));

    adapter.dispose();
    const countAfterDispose = events.length;

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events.length).toBe(countAfterDispose);
  });

  it("startWatching returns noop when updateIntervalMs is 0", () => {
    const stop = adapter.startWatching(() => {});
    expect(typeof stop).toBe("function");
    stop(); // should not throw
  });
});

// ── CopilotSessionManager tests ──────────────────────────

describe("CopilotSessionManager", () => {
  let manager: CopilotSessionManager;
  let adapter: MockCopilotAdapter;

  beforeEach(() => {
    adapter = new MockCopilotAdapter({ updateIntervalMs: 0 });
    manager = new CopilotSessionManager({ adapter });
  });

  afterEach(() => {
    manager.dispose();
  });

  it("listSessions delegates to adapter", async () => {
    const sessions = await manager.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("getSession delegates to adapter", async () => {
    const sessions = await manager.listSessions();
    const session = await manager.getSession(sessions[0].id);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(sessions[0].id);
  });

  it("getSession returns null for unknown id", async () => {
    const session = await manager.getSession("nonexistent");
    expect(session).toBeNull();
  });

  it("fires onSessionChange callback when watching", async () => {
    const fastAdapter = new MockCopilotAdapter({ updateIntervalMs: 50 });
    const events: SessionChangeEvent[] = [];

    const mgr = new CopilotSessionManager({
      adapter: fastAdapter,
      onSessionChange: (event) => events.push(event),
    });

    mgr.startWatching();
    await new Promise((resolve) => setTimeout(resolve, 200));
    mgr.dispose();

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("startWatching is idempotent", () => {
    const fastAdapter = new MockCopilotAdapter({ updateIntervalMs: 100 });
    const mgr = new CopilotSessionManager({ adapter: fastAdapter });

    // Calling twice should not throw or create duplicate watchers
    mgr.startWatching();
    mgr.startWatching();
    mgr.dispose();
  });

  it("dispose is safe to call multiple times", () => {
    manager.dispose();
    manager.dispose(); // should not throw
  });
});
