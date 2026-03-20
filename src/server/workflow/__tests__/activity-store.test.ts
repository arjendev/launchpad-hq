import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityStore, type ActivityEventType } from "../../workflow/activity-store.js";

describe("ActivityStore", () => {
  let store: ActivityStore;

  beforeEach(() => {
    store = new ActivityStore(5, 10); // small capacities for testing
  });

  describe("emit and retrieval", () => {
    it("emits an event and retrieves it globally", () => {
      const event = store.emit({
        type: "coordinator-started",
        projectOwner: "acme",
        projectRepo: "app",
        message: "Coordinator started",
        severity: "info",
      });

      expect(event.id).toBeTruthy();
      expect(event.timestamp).toBeTruthy();
      expect(event.type).toBe("coordinator-started");

      const result = store.getGlobal();
      expect(result.events).toHaveLength(1);
      expect(result.events[0].id).toBe(event.id);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it("emits an event and retrieves it by project", () => {
      store.emit({
        type: "issue-dispatched",
        projectOwner: "acme",
        projectRepo: "app",
        issueNumber: 42,
        message: "Dispatched #42",
        severity: "info",
      });

      const result = store.getByProject("acme", "app");
      expect(result.events).toHaveLength(1);
      expect(result.events[0].issueNumber).toBe(42);
    });

    it("returns empty for unknown project", () => {
      const result = store.getByProject("unknown", "repo");
      expect(result.events).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe("ring buffer behavior", () => {
    it("evicts oldest events when project buffer is full", () => {
      // Capacity is 5 per project
      for (let i = 1; i <= 7; i++) {
        store.emit({
          type: "progress",
          projectOwner: "acme",
          projectRepo: "app",
          issueNumber: i,
          message: `Progress #${i}`,
          severity: "info",
        });
      }

      const result = store.getByProject("acme", "app");
      expect(result.total).toBe(5);
      // Newest first — should have 7, 6, 5, 4, 3
      expect(result.events[0].issueNumber).toBe(7);
      expect(result.events[4].issueNumber).toBe(3);
    });

    it("evicts oldest events when global buffer is full", () => {
      // Global capacity is 10
      for (let i = 1; i <= 12; i++) {
        store.emit({
          type: "progress",
          projectOwner: "acme",
          projectRepo: `repo-${i}`,
          message: `Event ${i}`,
          severity: "info",
        });
      }

      expect(store.globalSize).toBe(10);
      const result = store.getGlobal({ limit: 200 });
      expect(result.total).toBe(10);
      // Newest first — should start from 12
      expect(result.events[0].message).toBe("Event 12");
      expect(result.events[9].message).toBe("Event 3");
    });
  });

  describe("filtering", () => {
    beforeEach(() => {
      store.emit({
        type: "coordinator-started",
        projectOwner: "acme",
        projectRepo: "app",
        message: "Started",
        severity: "info",
      });
      store.emit({
        type: "coordinator-crashed",
        projectOwner: "acme",
        projectRepo: "app",
        message: "Crashed",
        severity: "urgent",
      });
      store.emit({
        type: "elicitation-requested",
        projectOwner: "acme",
        projectRepo: "other",
        issueNumber: 5,
        message: "Need input",
        severity: "warning",
      });
    });

    it("filters by event type", () => {
      const result = store.getGlobal({ types: ["coordinator-crashed"] });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("coordinator-crashed");
    });

    it("filters by multiple types", () => {
      const result = store.getGlobal({ types: ["coordinator-started", "coordinator-crashed"] });
      expect(result.events).toHaveLength(2);
    });

    it("filters by since timestamp", () => {
      // All events should have timestamps after epoch
      const result = store.getGlobal({ since: "1970-01-01T00:00:00Z" });
      expect(result.total).toBe(3);

      // Filter out everything with a future timestamp
      const futureResult = store.getGlobal({ since: "2099-01-01T00:00:00Z" });
      expect(futureResult.total).toBe(0);
    });
  });

  describe("pagination", () => {
    beforeEach(() => {
      for (let i = 1; i <= 8; i++) {
        store.emit({
          type: "progress",
          projectOwner: "acme",
          projectRepo: "app",
          issueNumber: i,
          message: `Event ${i}`,
          severity: "info",
        });
      }
    });

    it("limits results", () => {
      const result = store.getGlobal({ limit: 3 });
      expect(result.events).toHaveLength(3);
      expect(result.total).toBe(8);
      expect(result.hasMore).toBe(true);
    });

    it("returns all when limit exceeds total", () => {
      const result = store.getGlobal({ limit: 100 });
      expect(result.events).toHaveLength(8);
      expect(result.hasMore).toBe(false);
    });

    it("clamps limit to minimum of 1", () => {
      const result = store.getGlobal({ limit: 0 });
      expect(result.events).toHaveLength(1);
    });
  });

  describe("event listener", () => {
    it("notifies listeners on emit", () => {
      const listener = vi.fn();
      store.onEvent(listener);

      store.emit({
        type: "coordinator-started",
        projectOwner: "acme",
        projectRepo: "app",
        message: "Started",
        severity: "info",
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].type).toBe("coordinator-started");
    });

    it("unsubscribes listener", () => {
      const listener = vi.fn();
      const unsub = store.onEvent(listener);

      store.emit({
        type: "coordinator-started",
        projectOwner: "acme",
        projectRepo: "app",
        message: "Started",
        severity: "info",
      });
      unsub();
      store.emit({
        type: "coordinator-crashed",
        projectOwner: "acme",
        projectRepo: "app",
        message: "Crashed",
        severity: "urgent",
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("metadata", () => {
    it("tracks project keys", () => {
      store.emit({
        type: "progress",
        projectOwner: "acme",
        projectRepo: "alpha",
        message: "A",
        severity: "info",
      });
      store.emit({
        type: "progress",
        projectOwner: "acme",
        projectRepo: "beta",
        message: "B",
        severity: "info",
      });

      const keys = store.getProjectKeys();
      expect(keys).toContain("acme/alpha");
      expect(keys).toContain("acme/beta");
    });

    it("returns project size", () => {
      store.emit({
        type: "progress",
        projectOwner: "acme",
        projectRepo: "app",
        message: "A",
        severity: "info",
      });
      store.emit({
        type: "progress",
        projectOwner: "acme",
        projectRepo: "app",
        message: "B",
        severity: "info",
      });

      expect(store.projectSize("acme", "app")).toBe(2);
      expect(store.projectSize("unknown", "repo")).toBe(0);
    });
  });
});
