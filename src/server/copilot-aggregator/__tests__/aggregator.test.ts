import { describe, it, expect, beforeEach, vi } from "vitest";
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
});
