import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotSessionAggregator } from "../aggregator.js";
import type { CopilotSessionInfo, CopilotSessionEvent } from "../../../shared/protocol.js";

function makeSessionInfo(overrides: Partial<CopilotSessionInfo> = {}): CopilotSessionInfo {
  return {
    sessionId: "sess-1",
    state: "active",
    model: "gpt-4",
    startedAt: 1000,
    lastActivityAt: 2000,
    ...overrides,
  };
}

describe("CopilotSessionAggregator", () => {
  let aggregator: CopilotSessionAggregator;

  beforeEach(() => {
    aggregator = new CopilotSessionAggregator();
  });

  // ── updateSessions ────────────────────────────────────

  describe("updateSessions", () => {
    it("adds sessions from a daemon", () => {
      aggregator.updateSessions("d1", "proj-1", [
        makeSessionInfo({ sessionId: "s1" }),
        makeSessionInfo({ sessionId: "s2" }),
      ]);

      expect(aggregator.size).toBe(2);
      expect(aggregator.getSession("s1")).toBeDefined();
      expect(aggregator.getSession("s1")!.daemonId).toBe("d1");
      expect(aggregator.getSession("s1")!.projectId).toBe("proj-1");
    });

    it("maps CopilotSessionState to AggregatedSession status", () => {
      aggregator.updateSessions("d1", "proj-1", [
        makeSessionInfo({ sessionId: "s1", state: "active" }),
        makeSessionInfo({ sessionId: "s2", state: "idle" }),
        makeSessionInfo({ sessionId: "s3", state: "ended" }),
      ]);

      expect(aggregator.getSession("s1")!.status).toBe("active");
      expect(aggregator.getSession("s2")!.status).toBe("idle");
      expect(aggregator.getSession("s3")!.status).toBe("idle"); // ended → idle
    });

    it("updates existing session in place", () => {
      aggregator.updateSessions("d1", "proj-1", [
        makeSessionInfo({ sessionId: "s1", state: "active" }),
      ]);

      const before = aggregator.getSession("s1")!.updatedAt;

      aggregator.updateSessions("d1", "proj-1", [
        makeSessionInfo({ sessionId: "s1", state: "idle" }),
      ]);

      expect(aggregator.getSession("s1")!.status).toBe("idle");
      expect(aggregator.getSession("s1")!.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it("emits sessions-updated event", () => {
      const handler = vi.fn();
      aggregator.on("sessions-updated", handler);

      aggregator.updateSessions("d1", "proj-1", [makeSessionInfo()]);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toHaveLength(1);
    });
  });

  // ── handleSessionEvent ────────────────────────────────

  describe("handleSessionEvent", () => {
    it("updates lastEvent on an existing session", () => {
      aggregator.updateSessions("d1", "proj-1", [
        makeSessionInfo({ sessionId: "s1" }),
      ]);

      const event: CopilotSessionEvent = {
        type: "session.start",
        timestamp: 5000,
        data: {},
      };

      aggregator.handleSessionEvent("d1", "s1", event);

      const session = aggregator.getSession("s1")!;
      expect(session.lastEvent).toEqual({ type: "session.start", timestamp: 5000 });
    });

    it("creates a stub session for unknown session id", () => {
      const event: CopilotSessionEvent = {
        type: "session.start",
        timestamp: 5000,
        data: {},
      };

      aggregator.handleSessionEvent("d1", "unknown-sess", event);

      expect(aggregator.size).toBe(1);
      const session = aggregator.getSession("unknown-sess");
      expect(session).toBeDefined();
      expect(session!.daemonId).toBe("d1");
      expect(session!.status).toBe("active");
    });

    it("emits session-event", () => {
      const handler = vi.fn();
      aggregator.on("session-event", handler);

      const event: CopilotSessionEvent = { type: "session.error", timestamp: 9000, data: {} };
      aggregator.handleSessionEvent("d1", "s1", event);

      expect(handler).toHaveBeenCalledWith("s1", event);
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

  // ── removeDaemon ──────────────────────────────────────

  describe("removeDaemon", () => {
    it("removes all sessions for a daemon", () => {
      aggregator.updateSessions("d1", "proj-1", [
        makeSessionInfo({ sessionId: "s1" }),
        makeSessionInfo({ sessionId: "s2" }),
      ]);
      aggregator.updateSessions("d2", "proj-2", [
        makeSessionInfo({ sessionId: "s3" }),
      ]);

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
      aggregator.updateSessions("d1", "proj-1", [
        makeSessionInfo({ sessionId: "s1" }),
      ]);
      aggregator.appendMessages("s1", [
        { role: "user", content: "hi", timestamp: 1000 },
      ]);

      aggregator.removeDaemon("d1");

      expect(aggregator.getMessages("s1")).toEqual([]);
    });

    it("emits sessions-updated when sessions were removed", () => {
      aggregator.updateSessions("d1", "proj-1", [
        makeSessionInfo({ sessionId: "s1" }),
      ]);

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
      aggregator.updateSessions("d1", "proj-1", [
        makeSessionInfo({ sessionId: "s1" }),
        makeSessionInfo({ sessionId: "s2" }),
      ]);
      aggregator.updateSessions("d2", "proj-2", [
        makeSessionInfo({ sessionId: "s3" }),
      ]);
    });

    it("getAllSessions returns all sessions", () => {
      expect(aggregator.getAllSessions()).toHaveLength(3);
    });

    it("getSessionsByProject filters by project", () => {
      const sessions = aggregator.getSessionsByProject("proj-1");
      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.projectId === "proj-1")).toBe(true);
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
});
