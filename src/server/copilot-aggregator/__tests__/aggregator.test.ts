import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CopilotSessionAggregator } from "../aggregator.js";
import type { SessionMetadata, SessionEvent } from "@github/copilot-sdk";
import type { AggregatedSession } from "../../../shared/protocol.js";

function makeSessionMetadata(overrides: Partial<SessionMetadata> & { sessionId: string }): SessionMetadata {
  return {
    startTime: new Date(1000),
    modifiedTime: new Date(2000),
    isRemote: false,
    ...overrides,
  } as SessionMetadata;
}

/** Create a minimal synthetic SessionEvent for testing */
function mockEvent(type: string, data: Record<string, unknown> = {}): SessionEvent {
  return {
    id: 'evt-1',
    timestamp: new Date().toISOString(),
    parentId: null,
    type,
    data,
  } as SessionEvent;
}

describe("CopilotSessionAggregator", () => {
  let aggregator: CopilotSessionAggregator;

  beforeEach(() => {
    aggregator = new CopilotSessionAggregator();
  });

  // ── trackNewSession + updateSessions ─────────────────

  describe("trackNewSession", () => {
    it("adds a new session", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.trackNewSession("d1", "proj-1", "s2");

      expect(aggregator.size).toBe(2);
      expect(aggregator.getSession("s1")).toBeDefined();
      expect(aggregator.getInternalSession("s1")!.daemonId).toBe("d1");
      expect(aggregator.getInternalSession("s1")!.projectId).toBe("proj-1");
    });

    it("defaults status to idle", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      expect(aggregator.getSession("s1")!.status).toBe("idle");
    });

    it("emits sessions-updated event", () => {
      const handler = vi.fn();
      aggregator.on("sessions-updated", handler);

      aggregator.trackNewSession("d1", "proj-1", "sess-1");

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toHaveLength(1);
    });
  });

  describe("updateSessions", () => {
    it("updates summary on existing tracked session", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      const before = aggregator.getSession("s1")!.updatedAt;

      aggregator.updateSessions("d1", "proj-1", [
        makeSessionMetadata({ sessionId: "s1", summary: "Updated" }),
      ]);

      expect(aggregator.getSession("s1")!.summary).toBe("Updated");
      expect(aggregator.getSession("s1")!.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it("does NOT create new sessions from metadata", () => {
      aggregator.updateSessions("d1", "proj-1", [
        makeSessionMetadata({ sessionId: "s-new" }),
      ]);

      expect(aggregator.size).toBe(0);
      expect(aggregator.getSession("s-new")).toBeUndefined();
    });
  });

  // ── handleSessionEvent ────────────────────────────────

  describe("handleSessionEvent", () => {
    it("updates lastEvent on an existing session", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      const event = mockEvent("session.start");

      aggregator.handleSessionEvent("d1", "s1", event);

      const session = aggregator.getSession("s1")!;
      expect(session.lastEvent).toBeDefined();
      expect(session.lastEvent!.type).toBe("session.start");
    });

    it("creates a stub session for unknown session id", () => {
      const event = mockEvent("session.start");

      aggregator.handleSessionEvent("d1", "unknown-sess", event);

      expect(aggregator.size).toBe(1);
      const session = aggregator.getSession("unknown-sess");
      expect(session).toBeDefined();
      expect(aggregator.getInternalSession("unknown-sess")!.daemonId).toBe("d1");
      expect(session!.status).toBe("idle");
    });

    it("emits session-event", () => {
      const handler = vi.fn();
      aggregator.on("session-event", handler);

      const event = mockEvent("session.error");
      aggregator.handleSessionEvent("d1", "s1", event);

      expect(handler).toHaveBeenCalledWith("s1", event);
    });

    it("captures model from session.model_change using newModel field", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.handleSessionEvent("d1", "s1", mockEvent("session.model_change", { newModel: "claude-opus-4.6" }));
      expect(aggregator.getSession("s1")!.model).toBe("claude-opus-4.6");
    });

    it("captures initial model from session.tools_updated", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.handleSessionEvent("d1", "s1", mockEvent("session.tools_updated" as string, { model: "claude-sonnet-4.5" }) as SessionEvent);
      expect(aggregator.getSession("s1")!.model).toBe("claude-sonnet-4.5");
    });

    it("does not overwrite model from model_change with tools_updated", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.handleSessionEvent("d1", "s1", mockEvent("session.model_change", { newModel: "claude-opus-4.6" }));
      aggregator.handleSessionEvent("d1", "s1", mockEvent("session.tools_updated" as string, { model: "claude-sonnet-4.5" }) as SessionEvent);
      expect(aggregator.getSession("s1")!.model).toBe("claude-opus-4.6");
    });
  });

  // ── handleSdkStateChange ──────────────────────────────

  describe("handleSdkStateChange", () => {
    it("stores SDK state for a daemon", () => {
      aggregator.handleSdkStateChange("d1", "connected");

      const state = aggregator.getSdkState("d1");
      expect(state).toBeDefined();
      expect(state!.state).toBe("connected");
    });

    it("stores error detail", () => {
      aggregator.handleSdkStateChange("d1", "error", "connection refused");

      const state = aggregator.getSdkState("d1");
      expect(state!.error).toBe("connection refused");
    });

    it("emits sdk-state-changed event", () => {
      const handler = vi.fn();
      aggregator.on("sdk-state-changed", handler);

      aggregator.handleSdkStateChange("d1", "disconnected");

      expect(handler).toHaveBeenCalledWith("d1", "disconnected");
    });
  });

  // ── Conversation history ──────────────────────────────

  describe("conversation history", () => {
    it("appends and retrieves messages", () => {
      aggregator.appendMessages("s1", [
        { role: "user", content: "hello", timestamp: 1000 },
      ]);
      aggregator.appendMessages("s1", [
        { role: "assistant", content: "hi!", timestamp: 2000 },
      ]);

      const msgs = aggregator.getMessages("s1");
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
    });

    it("returns empty array for unknown session", () => {
      expect(aggregator.getMessages("nonexistent")).toEqual([]);
    });
  });

  // ── Query methods ─────────────────────────────────────

  describe("queries", () => {
    it("removes all sessions for a daemon", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.trackNewSession("d1", "proj-1", "s2");
      aggregator.trackNewSession("d2", "proj-2", "s3");

      aggregator.removeDaemon("d1");

      expect(aggregator.size).toBe(1);
      expect(aggregator.getSession("s1")).toBeUndefined();
      expect(aggregator.getSession("s2")).toBeUndefined();
      expect(aggregator.getSession("s3")).toBeDefined();
    });

    it("removes SDK state for daemon", () => {
      aggregator.handleSdkStateChange("d1", "connected");
      aggregator.removeDaemon("d1");

      expect(aggregator.getSdkState("d1")).toBeUndefined();
    });

    it("removes conversation history for daemon sessions", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.appendMessages("s1", [
        { role: "user", content: "hi", timestamp: 1000 },
      ]);

      aggregator.removeDaemon("d1");

      expect(aggregator.getMessages("s1")).toEqual([]);
    });

    it("emits sessions-updated when sessions were removed", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      const handler = vi.fn();
      aggregator.on("sessions-updated", handler);

      aggregator.removeDaemon("d1");

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toHaveLength(0);
    });

    it("does not emit sessions-updated when no sessions removed", () => {
      const handler = vi.fn();
      aggregator.on("sessions-updated", handler);

      aggregator.removeDaemon("d-nonexistent");

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Query methods ─────────────────────────────────────

  describe("queries", () => {
    beforeEach(() => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.trackNewSession("d1", "proj-1", "s2");
      aggregator.trackNewSession("d2", "proj-2", "s3");
    });

    it("getAllSessions returns all sessions", () => {
      expect(aggregator.getAllSessions()).toHaveLength(3);
    });

    it("getSessionsByProject filters by project", () => {
      const sessions = aggregator.getSessionsByProject("proj-1");
      expect(sessions).toHaveLength(2);
    });

    it("getSession returns undefined for missing id", () => {
      expect(aggregator.getSession("nonexistent")).toBeUndefined();
    });

    it("findDaemonForSession returns correct daemon id", () => {
      expect(aggregator.findDaemonForSession("s3")).toBe("d2");
    });

    it("findDaemonForSession returns undefined for missing session", () => {
      expect(aggregator.findDaemonForSession("nope")).toBeUndefined();
    });
  });

  // ── Tool invocations ─────────────────────────────────

  describe("handleToolInvocation", () => {
    it("stores tool invocation in history", () => {
      aggregator.handleToolInvocation("s1", "proj-1", "report_progress", { status: "working", summary: "On it" }, 5000);

      const invocations = aggregator.getToolInvocations("s1");
      expect(invocations).toHaveLength(1);
      expect(invocations[0].tool).toBe("report_progress");
      expect(invocations[0].args.summary).toBe("On it");
      expect(invocations[0].timestamp).toBe(5000);
    });

    it("accumulates multiple invocations for same session", () => {
      aggregator.handleToolInvocation("s1", "proj-1", "report_progress", { status: "working", summary: "Starting" }, 1000);
      aggregator.handleToolInvocation("s1", "proj-1", "report_progress", { status: "completed", summary: "Done" }, 2000);

      expect(aggregator.getToolInvocations("s1")).toHaveLength(2);
    });

    it("returns empty array for unknown session", () => {
      expect(aggregator.getToolInvocations("nonexistent")).toEqual([]);
    });

    it("updates session status to 'error' for report_blocker", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      aggregator.handleToolInvocation("s1", "proj-1", "report_blocker", { blocker: "Cannot compile" }, 5000);

      expect(aggregator.getSession("s1")!.status).toBe("error");
    });

    it("updates session status to 'error' for report_progress with blocked status", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      aggregator.handleToolInvocation("s1", "proj-1", "report_progress", { status: "blocked", summary: "Stuck" }, 5000);

      expect(aggregator.getSession("s1")!.status).toBe("error");
    });

    it("updates session status to 'idle' for report_progress with completed status", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      aggregator.handleToolInvocation("s1", "proj-1", "report_progress", { status: "completed", summary: "All done" }, 5000);

      expect(aggregator.getSession("s1")!.status).toBe("idle");
    });

    it("emits tool-invocation event", () => {
      const handler = vi.fn();
      aggregator.on("tool-invocation", handler);

      aggregator.handleToolInvocation("s1", "proj-1", "request_human_review", { reason: "Check code", urgency: "high" }, 5000);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toMatchObject({
        sessionId: "s1",
        tool: "request_human_review",
      });
    });

    it("cleans up tool invocations when daemon is removed", () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.handleToolInvocation("s1", "proj-1", "report_progress", { status: "working", summary: "hi" }, 1000);

      aggregator.removeDaemon("d1");

      expect(aggregator.getToolInvocations("s1")).toEqual([]);
    });
  });

  // ── Event log (getEvents) ─────────────────────────────

  describe("getEvents", () => {
    it("returns empty result for unknown session", async () => {
      const result = await aggregator.getEvents("nonexistent");
      expect(result.events).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.oldestTimestamp).toBeNull();
    });

    it("stores session events and retrieves them in chronological order", async () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      aggregator.handleSessionEvent("d1", "s1", mockEvent("session.start"));
      aggregator.handleSessionEvent("d1", "s1", mockEvent("user.message"));
      aggregator.handleSessionEvent("d1", "s1", mockEvent("assistant.message"));

      const result = await aggregator.getEvents("s1");
      expect(result.events).toHaveLength(3);
      expect(result.events[0].type).toBe("session.start");
      expect(result.events[2].type).toBe("assistant.message");
      expect(result.hasMore).toBe(false);
    });

    it("respects limit parameter", async () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      for (let i = 0; i < 10; i++) {
        aggregator.handleSessionEvent("d1", "s1", {
          id: `evt-${i}`,
          timestamp: new Date(1000 + i * 100).toISOString(),
          parentId: null,
          type: "user.message",
          data: { index: i },
        } as SessionEvent);
      }

      const result = await aggregator.getEvents("s1", undefined, 3);
      expect(result.events).toHaveLength(3);
      expect(result.hasMore).toBe(true);
      // Should return the last 3 events (most recent page)
      expect((result.events[0].data as Record<string, unknown>).index).toBe(7);
      expect((result.events[2].data as Record<string, unknown>).index).toBe(9);
    });

    it("paginates backward using 'before' cursor", async () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      for (let i = 0; i < 10; i++) {
        aggregator.handleSessionEvent("d1", "s1", {
          id: `evt-${i}`,
          timestamp: new Date(1000 + i * 100).toISOString(),
          parentId: null,
          type: "user.message",
          data: { index: i },
        } as SessionEvent);
      }

      // Get latest 3
      const page1 = await aggregator.getEvents("s1", undefined, 3);
      expect(page1.events).toHaveLength(3);
      expect(page1.oldestTimestamp).not.toBeNull();

      // Get next older page using oldestTimestamp as cursor
      const page2 = await aggregator.getEvents("s1", page1.oldestTimestamp!, 3);
      expect(page2.events).toHaveLength(3);
      expect((page2.events[2].data as Record<string, unknown>).index).toBe(6);
      expect(page2.hasMore).toBe(true);
    });

    it("caps limit at 500", async () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      for (let i = 0; i < 600; i++) {
        aggregator.handleSessionEvent("d1", "s1", {
          id: `evt-${i}`,
          timestamp: new Date(1000 + i).toISOString(),
          parentId: null,
          type: "user.message",
          data: {},
        } as SessionEvent);
      }

      const result = await aggregator.getEvents("s1", undefined, 999);
      expect(result.events).toHaveLength(500);
      expect(result.hasMore).toBe(true);
    });

    it("stores tool invocation events alongside session events", async () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.handleSessionEvent("d1", "s1", mockEvent("session.start"));
      aggregator.handleToolInvocation("s1", "proj-1", "report_progress", { status: "working" }, Date.now());

      const result = await aggregator.getEvents("s1");
      expect(result.events).toHaveLength(2);
      expect(result.events[0].type).toBe("session.start");
      expect(result.events[1].type).toBe("copilot:tool-invocation");
      expect(result.events[1].data).toHaveProperty("tool", "report_progress");
    });

    it("preserves id and parentId from original events", async () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");

      aggregator.handleSessionEvent("d1", "s1", {
        id: "my-event-id",
        parentId: "parent-id",
        timestamp: new Date().toISOString(),
        type: "tool.execution_start",
        data: { toolName: "bash" },
      } as SessionEvent);

      const result = await aggregator.getEvents("s1");
      expect(result.events[0].id).toBe("my-event-id");
      expect(result.events[0].parentId).toBe("parent-id");
    });

    it("drops oldest events when exceeding MAX_EVENTS_PER_SESSION", async () => {
      const origMax = CopilotSessionAggregator.MAX_EVENTS_PER_SESSION;
      CopilotSessionAggregator.MAX_EVENTS_PER_SESSION = 5;
      try {
        aggregator.trackNewSession("d1", "proj-1", "s1");

        for (let i = 0; i < 8; i++) {
          aggregator.handleSessionEvent("d1", "s1", {
            id: `evt-${i}`,
            timestamp: new Date(1000 + i * 100).toISOString(),
            parentId: null,
            type: "user.message",
            data: { index: i },
          } as SessionEvent);
        }

        const result = await aggregator.getEvents("s1");
        expect(result.events).toHaveLength(5);
        // Oldest 3 should have been dropped
        expect((result.events[0].data as Record<string, unknown>).index).toBe(3);
      } finally {
        CopilotSessionAggregator.MAX_EVENTS_PER_SESSION = origMax;
      }
    });

    it("cleans up event logs when session is removed", async () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.handleSessionEvent("d1", "s1", mockEvent("session.start"));

      aggregator.removeSession("s1");

      expect((await aggregator.getEvents("s1")).events).toEqual([]);
    });

    it("cleans up event logs when daemon is removed", async () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.handleSessionEvent("d1", "s1", mockEvent("session.start"));

      aggregator.removeDaemon("d1");

      expect((await aggregator.getEvents("s1")).events).toEqual([]);
    });

    it("stores session.shutdown events", async () => {
      aggregator.trackNewSession("d1", "proj-1", "s1");
      aggregator.handleSessionEvent("d1", "s1", mockEvent("session.shutdown"));

      const result = await aggregator.getEvents("s1");
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("session.shutdown");
    });
  });

  // ── Disk persistence integration ─────────────────────
  describe("disk persistence integration", () => {
    let tempDir: string;

    beforeEach(async () => {
      const { mkdtemp } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      tempDir = await mkdtemp(join(tmpdir(), "agg-persist-"));
    });

    afterEach(async () => {
      const { rm } = await import("node:fs/promises");
      await rm(tempDir, { recursive: true, force: true });
    });

    it("loads events from disk when in-memory is empty (simulated HQ restart)", async () => {
      const { EventPersistence } = await import("../event-persistence.js");
      const persistence = new EventPersistence({ dataDir: tempDir, flushIntervalMs: 10 });

      // Pre-restart: write events via aggregator with persistence
      const agg1 = new CopilotSessionAggregator(persistence);
      agg1.trackNewSession("d1", "proj-1", "s1");
      agg1.handleSessionEvent("d1", "s1", {
        id: "evt-0",
        timestamp: new Date(1000).toISOString(),
        parentId: null,
        type: "session.start",
        data: {},
      } as SessionEvent);
      agg1.handleSessionEvent("d1", "s1", {
        id: "evt-1",
        timestamp: new Date(2000).toISOString(),
        parentId: null,
        type: "user.message",
        data: { content: "hello" },
      } as SessionEvent);
      await agg1.flushEvents();

      // Simulate restart: new aggregator + new persistence (same dir)
      const persistence2 = new EventPersistence({ dataDir: tempDir, flushIntervalMs: 10 });
      const agg2 = new CopilotSessionAggregator(persistence2);
      agg2.trackNewSession("d1", "proj-1", "s1"); // re-tracked on reconnect

      const result = await agg2.getEvents("s1");
      expect(result.events).toHaveLength(2);
      expect(result.events[0].type).toBe("session.start");
      expect(result.events[1].type).toBe("user.message");
    });

    it("cleanupSessionEvents deletes the JSONL file", async () => {
      const { EventPersistence } = await import("../event-persistence.js");
      const persistence = new EventPersistence({ dataDir: tempDir, flushIntervalMs: 10 });

      const agg = new CopilotSessionAggregator(persistence);
      agg.trackNewSession("d1", "proj-1", "s1");
      agg.handleSessionEvent("d1", "s1", mockEvent("session.start"));
      await agg.flushEvents();

      expect(await persistence.hasEvents("s1")).toBe(true);
      await agg.cleanupSessionEvents("s1");
      expect(await persistence.hasEvents("s1")).toBe(false);
    });
  });
});
