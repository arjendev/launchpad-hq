import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ElicitationStore } from "../../workflow/elicitation-store.js";

function makeElicitation(overrides: Partial<{ id: string; sessionId: string; projectId: string; message: string; requestedSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }; issueNumber: number }> = {}) {
  return {
    id: overrides.id ?? "elicit-1",
    sessionId: overrides.sessionId ?? "session-abc",
    projectId: overrides.projectId ?? "test-owner/test-repo",
    message: overrides.message ?? "Choose a framework",
    requestedSchema: overrides.requestedSchema ?? { type: 'object' as const, properties: {} },
    issueNumber: overrides.issueNumber,
  };
}

describe("ElicitationStore", () => {
  let store: ElicitationStore;

  beforeEach(() => {
    vi.useFakeTimers();
    // Disable auto-cleanup for unit tests (set cleanupMs to 0)
    store = new ElicitationStore(10_000, 0);
  });

  afterEach(() => {
    store.close();
    vi.useRealTimers();
  });

  describe("add / get", () => {
    it("adds and retrieves an elicitation", () => {
      const result = store.add(makeElicitation());
      expect(result.status).toBe("pending");
      expect(result.id).toBe("elicit-1");

      const fetched = store.get("elicit-1");
      expect(fetched).toBeDefined();
      expect(fetched!.message).toBe("Choose a framework");
      expect(fetched!.status).toBe("pending");
    });

    it("returns undefined for unknown id", () => {
      expect(store.get("nonexistent")).toBeUndefined();
    });

    it("stores requestedSchema and issueNumber", () => {
      store.add(makeElicitation({
        requestedSchema: { type: 'object', properties: { choice: { type: 'string', enum: ['React', 'Vue'] } } },
        issueNumber: 42,
      }));
      const e = store.get("elicit-1")!;
      expect(e.requestedSchema.properties).toHaveProperty("choice");
      expect(e.issueNumber).toBe(42);
    });

    it("tracks size correctly", () => {
      expect(store.size).toBe(0);
      store.add(makeElicitation({ id: "a" }));
      store.add(makeElicitation({ id: "b" }));
      expect(store.size).toBe(2);
    });
  });

  describe("getAll / getByProject", () => {
    it("returns all elicitations", () => {
      store.add(makeElicitation({ id: "a" }));
      store.add(makeElicitation({ id: "b" }));
      expect(store.getAll()).toHaveLength(2);
    });

    it("filters by status", () => {
      store.add(makeElicitation({ id: "a" }));
      store.add(makeElicitation({ id: "b" }));
      store.answer("a", { choice: "React" });

      expect(store.getAll("pending")).toHaveLength(1);
      expect(store.getAll("answered")).toHaveLength(1);
      expect(store.getAll("timeout")).toHaveLength(0);
    });

    it("filters pending by project", () => {
      store.add(makeElicitation({ id: "a", projectId: "owner/repo1" }));
      store.add(makeElicitation({ id: "b", projectId: "owner/repo2" }));
      store.add(makeElicitation({ id: "c", projectId: "owner/repo1" }));

      const repo1 = store.getByProject("owner/repo1");
      expect(repo1).toHaveLength(2);

      const repo2 = store.getByProject("owner/repo2");
      expect(repo2).toHaveLength(1);
    });

    it("getByProject excludes non-pending entries", () => {
      store.add(makeElicitation({ id: "a", projectId: "owner/repo" }));
      store.add(makeElicitation({ id: "b", projectId: "owner/repo" }));
      store.answer("a", { done: true });

      expect(store.getByProject("owner/repo")).toHaveLength(1);
    });
  });

  describe("answer", () => {
    it("marks elicitation as answered", () => {
      store.add(makeElicitation());
      const result = store.answer("elicit-1", { choice: "React" });

      expect(result).toBeDefined();
      expect(result!.status).toBe("answered");
      expect(result!.response).toEqual({ choice: "React" });
      expect(result!.answeredAt).toBeDefined();
    });

    it("returns undefined for non-pending elicitation", () => {
      store.add(makeElicitation());
      store.answer("elicit-1", { choice: "React" });

      // Second answer fails
      const result = store.answer("elicit-1", { choice: "Vue" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for unknown id", () => {
      expect(store.answer("nonexistent", { v: "test" })).toBeUndefined();
    });
  });

  describe("timeout", () => {
    it("times out a pending elicitation after timeout period", () => {
      const onTimeout = vi.fn();
      store.onTimeout(onTimeout);

      store.add(makeElicitation());

      // Advance past timeout
      vi.advanceTimersByTime(10_001);

      const e = store.get("elicit-1")!;
      expect(e.status).toBe("timeout");
      expect(onTimeout).toHaveBeenCalledOnce();
      expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ id: "elicit-1", status: "timeout" }));
    });

    it("does not timeout if answered before deadline", () => {
      const onTimeout = vi.fn();
      store.onTimeout(onTimeout);

      store.add(makeElicitation());
      store.answer("elicit-1", { choice: "React" });

      vi.advanceTimersByTime(10_001);

      expect(store.get("elicit-1")!.status).toBe("answered");
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it("does not timeout an already-timed-out elicitation twice", () => {
      const onTimeout = vi.fn();
      store.onTimeout(onTimeout);

      store.add(makeElicitation());
      vi.advanceTimersByTime(10_001);
      expect(onTimeout).toHaveBeenCalledOnce();

      // Advancing more doesn't re-trigger
      vi.advanceTimersByTime(10_000);
      expect(onTimeout).toHaveBeenCalledOnce();
    });
  });

  describe("cleanupResolved", () => {
    it("removes answered elicitations older than cleanup period", () => {
      // Use a store with 1000ms cleanup threshold for testing
      const testStore = new ElicitationStore(60_000, 0);
      testStore.add(makeElicitation({ id: "a" }));
      testStore.answer("a", { done: true });

      // Manually override answeredAt to be old
      const entry = testStore.get("a")!;
      entry.answeredAt = Date.now() - 2_000;

      // cleanupMs = 0 means any resolved entry is eligible
      const removed = testStore.cleanupResolved();
      expect(removed).toBe(1);
      expect(testStore.size).toBe(0);
      testStore.close();
    });

    it("does not remove pending elicitations", () => {
      store.add(makeElicitation({ id: "a" }));
      const removed = store.cleanupResolved();
      expect(removed).toBe(0);
      expect(store.size).toBe(1);
    });

    it("removes timed-out entries older than cleanup period", () => {
      store.add(makeElicitation({ id: "a" }));
      vi.advanceTimersByTime(10_001); // trigger timeout
      expect(store.get("a")!.status).toBe("timeout");

      // Manually age the entry
      store.get("a")!.answeredAt = Date.now() - 1;

      const removed = store.cleanupResolved();
      expect(removed).toBe(1);
    });
  });

  describe("close", () => {
    it("clears all timers without errors", () => {
      store.add(makeElicitation({ id: "a" }));
      store.add(makeElicitation({ id: "b" }));
      expect(() => store.close()).not.toThrow();
    });

    it("prevents timeouts after close", () => {
      const onTimeout = vi.fn();
      store.onTimeout(onTimeout);

      store.add(makeElicitation());
      store.close();

      vi.advanceTimersByTime(20_000);
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });
});
