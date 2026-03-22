import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventPersistence } from "../event-persistence.js";
import type { StoredEvent } from "../aggregator.js";

function makeEvent(type: string, index: number): StoredEvent {
  return {
    type,
    data: { index },
    timestamp: new Date(1000 + index * 100).toISOString(),
    id: `evt-${index}`,
  };
}

describe("EventPersistence", () => {
  let tempDir: string;
  let persistence: EventPersistence;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "launchpad-events-"));
    persistence = new EventPersistence({
      dataDir: tempDir,
      flushThreshold: 100, // high threshold so we control flushing
      flushIntervalMs: 50,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("appendEvent + flush + loadEvents", () => {
    it("persists events to JSONL file and reads them back", async () => {
      const e1 = makeEvent("session.start", 0);
      const e2 = makeEvent("user.message", 1);

      persistence.appendEvent("sess-1", e1);
      persistence.appendEvent("sess-1", e2);
      await persistence.flush("sess-1");

      const events = await persistence.loadEvents("sess-1");
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(e1);
      expect(events[1]).toEqual(e2);
    });

    it("writes JSONL format (one JSON object per line)", async () => {
      const e1 = makeEvent("session.start", 0);
      persistence.appendEvent("sess-1", e1);
      await persistence.flush("sess-1");

      const raw = await readFile(join(tempDir, "sess-1.jsonl"), "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual(e1);
    });

    it("appends to existing file (not overwrite)", async () => {
      persistence.appendEvent("sess-1", makeEvent("session.start", 0));
      await persistence.flush("sess-1");

      persistence.appendEvent("sess-1", makeEvent("user.message", 1));
      await persistence.flush("sess-1");

      const events = await persistence.loadEvents("sess-1");
      expect(events).toHaveLength(2);
    });

    it("returns empty array for non-existent session", async () => {
      const events = await persistence.loadEvents("nonexistent");
      expect(events).toEqual([]);
    });

    it("keeps sessions isolated in separate files", async () => {
      persistence.appendEvent("sess-1", makeEvent("session.start", 0));
      persistence.appendEvent("sess-2", makeEvent("user.message", 1));
      await persistence.flushAll();

      const events1 = await persistence.loadEvents("sess-1");
      const events2 = await persistence.loadEvents("sess-2");
      expect(events1).toHaveLength(1);
      expect(events1[0].type).toBe("session.start");
      expect(events2).toHaveLength(1);
      expect(events2[0].type).toBe("user.message");
    });

    it("skips malformed lines gracefully", async () => {
      // Write valid event
      persistence.appendEvent("sess-1", makeEvent("session.start", 0));
      await persistence.flush("sess-1");

      // Manually append a malformed line
      const { appendFile: appendFileFn } = await import("node:fs/promises");
      await appendFileFn(join(tempDir, "sess-1.jsonl"), "not-json\n");

      // Write another valid event
      persistence.appendEvent("sess-1", makeEvent("user.message", 1));
      await persistence.flush("sess-1");

      const events = await persistence.loadEvents("sess-1");
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("session.start");
      expect(events[1].type).toBe("user.message");
    });
  });

  describe("buffered writes", () => {
    it("auto-flushes when threshold is reached", async () => {
      const smallBuf = new EventPersistence({
        dataDir: tempDir,
        flushThreshold: 3,
        flushIntervalMs: 10_000, // very long to ensure threshold triggers, not timer
      });

      for (let i = 0; i < 3; i++) {
        smallBuf.appendEvent("sess-1", makeEvent("user.message", i));
      }

      // Give time for the threshold-triggered flush
      await new Promise((r) => setTimeout(r, 50));

      const events = await smallBuf.loadEvents("sess-1");
      expect(events).toHaveLength(3);
    });

    it("auto-flushes after interval", async () => {
      const timerBuf = new EventPersistence({
        dataDir: tempDir,
        flushThreshold: 100,
        flushIntervalMs: 50,
      });

      timerBuf.appendEvent("sess-1", makeEvent("session.start", 0));

      // Wait for the timer to flush
      await new Promise((r) => setTimeout(r, 150));

      const events = await timerBuf.loadEvents("sess-1");
      expect(events).toHaveLength(1);
    });
  });

  describe("loadEvents flushes pending writes first", () => {
    it("ensures pending writes are flushed before reading", async () => {
      persistence.appendEvent("sess-1", makeEvent("session.start", 0));
      // Don't flush manually — loadEvents should do it

      const events = await persistence.loadEvents("sess-1");
      expect(events).toHaveLength(1);
    });
  });

  describe("hasEvents", () => {
    it("returns false for non-existent session", async () => {
      expect(await persistence.hasEvents("nonexistent")).toBe(false);
    });

    it("returns true after events are written", async () => {
      persistence.appendEvent("sess-1", makeEvent("session.start", 0));
      await persistence.flush("sess-1");
      expect(await persistence.hasEvents("sess-1")).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("deletes the JSONL file", async () => {
      persistence.appendEvent("sess-1", makeEvent("session.start", 0));
      await persistence.flush("sess-1");

      await persistence.cleanup("sess-1");

      expect(await persistence.hasEvents("sess-1")).toBe(false);
      const events = await persistence.loadEvents("sess-1");
      expect(events).toEqual([]);
    });

    it("cancels pending writes on cleanup", async () => {
      persistence.appendEvent("sess-1", makeEvent("session.start", 0));
      // Don't flush — cleanup should cancel the pending buffer
      await persistence.cleanup("sess-1");

      const events = await persistence.loadEvents("sess-1");
      expect(events).toEqual([]);
    });

    it("is safe to call for non-existent session", async () => {
      await expect(persistence.cleanup("nonexistent")).resolves.not.toThrow();
    });
  });

  describe("flushAll", () => {
    it("flushes all pending sessions", async () => {
      persistence.appendEvent("sess-1", makeEvent("session.start", 0));
      persistence.appendEvent("sess-2", makeEvent("user.message", 1));
      persistence.appendEvent("sess-3", makeEvent("assistant.message", 2));

      await persistence.flushAll();

      expect(await persistence.loadEvents("sess-1")).toHaveLength(1);
      expect(await persistence.loadEvents("sess-2")).toHaveLength(1);
      expect(await persistence.loadEvents("sess-3")).toHaveLength(1);
    });
  });

  describe("sessionId sanitization", () => {
    it("sanitizes path-traversal characters in session IDs", async () => {
      persistence.appendEvent("../../../etc/passwd", makeEvent("session.start", 0));
      await persistence.flush("../../../etc/passwd");

      // Should create a safely-named file in the temp dir, not traverse
      const events = await persistence.loadEvents("../../../etc/passwd");
      expect(events).toHaveLength(1);
    });
  });

  describe("integration: write → clear in-memory → load from disk", () => {
    it("reconstitutes events after simulated HQ restart", async () => {
      // Simulate pre-restart: write events
      persistence.appendEvent("sess-1", makeEvent("session.start", 0));
      persistence.appendEvent("sess-1", makeEvent("user.message", 1));
      persistence.appendEvent("sess-1", makeEvent("assistant.message", 2));
      await persistence.flushAll();

      // Simulate restart: create a new persistence instance pointing to same dir
      const newPersistence = new EventPersistence({
        dataDir: tempDir,
        flushThreshold: 100,
        flushIntervalMs: 50,
      });

      // Load events from disk — should get all 3
      const events = await newPersistence.loadEvents("sess-1");
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe("session.start");
      expect(events[1].type).toBe("user.message");
      expect(events[2].type).toBe("assistant.message");
    });
  });
});
