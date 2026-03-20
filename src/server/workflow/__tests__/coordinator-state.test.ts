import { describe, it, expect } from "vitest";
import {
  defaultCoordinatorState,
  coordinatorStarting,
  coordinatorStarted,
  coordinatorCrashed,
  coordinatorStopped,
  coordinatorHealthPing,
  addDispatch,
  updateDispatchStatus,
  getDispatch,
  getActiveDispatches,
  isCoordinatorReady,
} from "../coordinator-state.js";

describe("Coordinator State", () => {
  describe("defaultCoordinatorState", () => {
    it("returns idle state with no session", () => {
      const state = defaultCoordinatorState();
      expect(state.status).toBe("idle");
      expect(state.sessionId).toBeNull();
      expect(state.lastSeenAt).toBeNull();
      expect(state.startedAt).toBeNull();
      expect(state.error).toBeNull();
      expect(state.dispatches).toEqual([]);
    });
  });

  describe("coordinator lifecycle", () => {
    it("transitions to starting", () => {
      const state = defaultCoordinatorState();
      const updated = coordinatorStarting(state);
      expect(updated.status).toBe("starting");
      expect(updated.error).toBeNull();
      expect(updated.startedAt).toBeTruthy();
    });

    it("transitions to active with session ID", () => {
      const state = coordinatorStarting(defaultCoordinatorState());
      const updated = coordinatorStarted(state, "session-123");
      expect(updated.status).toBe("active");
      expect(updated.sessionId).toBe("session-123");
      expect(updated.lastSeenAt).toBeTruthy();
      expect(updated.error).toBeNull();
    });

    it("transitions to crashed with error", () => {
      const state = coordinatorStarted(defaultCoordinatorState(), "session-123");
      const updated = coordinatorCrashed(state, "OOM");
      expect(updated.status).toBe("crashed");
      expect(updated.error).toBe("OOM");
      expect(updated.sessionId).toBe("session-123");
    });

    it("transitions to stopped (idle)", () => {
      const state = coordinatorStarted(defaultCoordinatorState(), "session-123");
      const updated = coordinatorStopped(state);
      expect(updated.status).toBe("idle");
      expect(updated.sessionId).toBeNull();
      expect(updated.startedAt).toBeNull();
      expect(updated.error).toBeNull();
    });

    it("updates lastSeenAt on health ping", () => {
      const state = coordinatorStarted(defaultCoordinatorState(), "session-123");
      const before = state.lastSeenAt;
      // Small delay to ensure timestamp changes
      const updated = coordinatorHealthPing(state);
      expect(updated.lastSeenAt).toBeTruthy();
      expect(updated.status).toBe("active");
    });
  });

  describe("dispatch tracking", () => {
    it("adds a dispatch record", () => {
      const state = coordinatorStarted(defaultCoordinatorState(), "session-123");
      const updated = addDispatch(state, 42);
      expect(updated.dispatches).toHaveLength(1);
      expect(updated.dispatches[0].issueNumber).toBe(42);
      expect(updated.dispatches[0].status).toBe("pending");
      expect(updated.dispatches[0].dispatchedAt).toBeTruthy();
    });

    it("updates dispatch status to in-progress", () => {
      let state = coordinatorStarted(defaultCoordinatorState(), "session-123");
      state = addDispatch(state, 42);
      const updated = updateDispatchStatus(state, 42, "in-progress");
      expect(updated.dispatches[0].status).toBe("in-progress");
    });

    it("updates dispatch status to completed with timestamp", () => {
      let state = coordinatorStarted(defaultCoordinatorState(), "session-123");
      state = addDispatch(state, 42);
      const updated = updateDispatchStatus(state, 42, "completed");
      expect(updated.dispatches[0].status).toBe("completed");
      expect(updated.dispatches[0].completedAt).toBeTruthy();
    });

    it("updates dispatch status to failed with error", () => {
      let state = coordinatorStarted(defaultCoordinatorState(), "session-123");
      state = addDispatch(state, 42);
      const updated = updateDispatchStatus(state, 42, "failed", "Timeout");
      expect(updated.dispatches[0].status).toBe("failed");
      expect(updated.dispatches[0].error).toBe("Timeout");
      expect(updated.dispatches[0].completedAt).toBeTruthy();
    });

    it("getDispatch returns the dispatch record", () => {
      let state = coordinatorStarted(defaultCoordinatorState(), "session-123");
      state = addDispatch(state, 42);
      state = addDispatch(state, 43);
      const d = getDispatch(state, 42);
      expect(d?.issueNumber).toBe(42);
    });

    it("getDispatch returns undefined for unknown issue", () => {
      const state = defaultCoordinatorState();
      expect(getDispatch(state, 999)).toBeUndefined();
    });

    it("getActiveDispatches returns pending and in-progress", () => {
      let state = coordinatorStarted(defaultCoordinatorState(), "session-123");
      state = addDispatch(state, 1);
      state = addDispatch(state, 2);
      state = addDispatch(state, 3);
      state = updateDispatchStatus(state, 1, "in-progress");
      state = updateDispatchStatus(state, 3, "completed");

      const active = getActiveDispatches(state);
      expect(active).toHaveLength(2);
      expect(active.map((d) => d.issueNumber)).toEqual([1, 2]);
    });
  });

  describe("isCoordinatorReady", () => {
    it("returns true for active", () => {
      expect(isCoordinatorReady("active")).toBe(true);
    });

    it("returns false for idle", () => {
      expect(isCoordinatorReady("idle")).toBe(false);
    });

    it("returns false for starting", () => {
      expect(isCoordinatorReady("starting")).toBe(false);
    });

    it("returns false for crashed", () => {
      expect(isCoordinatorReady("crashed")).toBe(false);
    });
  });
});
