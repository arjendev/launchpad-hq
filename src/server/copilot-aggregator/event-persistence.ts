import { appendFile, readFile, mkdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { StoredEvent } from "./aggregator.js";

/** Default base directory for session event JSONL files */
const DEFAULT_DATA_DIR = join(homedir(), ".launchpad", "session-events");

/** Maximum pending events before forcing a flush */
const FLUSH_THRESHOLD = 10;

/** Time in ms to wait before flushing buffered writes */
const FLUSH_INTERVAL_MS = 100;

export interface EventPersistenceOptions {
  /** Override the data directory (default: ~/.launchpad/session-events/) */
  dataDir?: string;
  /** Override flush threshold for testing (default: 10 events) */
  flushThreshold?: number;
  /** Override flush interval for testing (default: 100ms) */
  flushIntervalMs?: number;
}

interface PendingBuffer {
  lines: string[];
  timer: ReturnType<typeof setTimeout>;
}

/**
 * JSONL-based persistence for session events.
 * Append-only writes with buffered flushing for performance.
 * Each session gets its own file: `{dataDir}/{sessionId}.jsonl`
 */
export class EventPersistence {
  private readonly dataDir: string;
  private readonly flushThreshold: number;
  private readonly flushIntervalMs: number;
  private readonly pendingBuffers = new Map<string, PendingBuffer>();
  private dirCreated = false;

  constructor(opts?: EventPersistenceOptions) {
    this.dataDir = opts?.dataDir ?? DEFAULT_DATA_DIR;
    this.flushThreshold = opts?.flushThreshold ?? FLUSH_THRESHOLD;
    this.flushIntervalMs = opts?.flushIntervalMs ?? FLUSH_INTERVAL_MS;
  }

  /** Resolve the JSONL file path for a session */
  private filePath(sessionId: string): string {
    // Sanitize sessionId to prevent path traversal
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dataDir, `${safe}.jsonl`);
  }

  /** Ensure the data directory exists (lazy, once) */
  private async ensureDir(): Promise<void> {
    if (this.dirCreated) return;
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    this.dirCreated = true;
  }

  /** Append a single event to the session's JSONL file (buffered) */
  appendEvent(sessionId: string, event: StoredEvent): void {
    const line = JSON.stringify(event) + "\n";
    let buf = this.pendingBuffers.get(sessionId);

    if (!buf) {
      buf = {
        lines: [],
        timer: setTimeout(() => void this.flush(sessionId), this.flushIntervalMs),
      };
      this.pendingBuffers.set(sessionId, buf);
    }

    buf.lines.push(line);

    if (buf.lines.length >= this.flushThreshold) {
      clearTimeout(buf.timer);
      void this.flush(sessionId);
    }
  }

  /** Flush pending writes for a single session */
  async flush(sessionId: string): Promise<void> {
    const buf = this.pendingBuffers.get(sessionId);
    if (!buf || buf.lines.length === 0) return;

    clearTimeout(buf.timer);
    const lines = buf.lines.splice(0);
    this.pendingBuffers.delete(sessionId);

    await this.ensureDir();
    await appendFile(this.filePath(sessionId), lines.join(""), {
      encoding: "utf-8",
      mode: 0o600,
    });
  }

  /** Flush all pending writes across all sessions */
  async flushAll(): Promise<void> {
    const sessionIds = [...this.pendingBuffers.keys()];
    await Promise.all(sessionIds.map((id) => this.flush(id)));
  }

  /** Load all events from a session's JSONL file. Returns empty array if file doesn't exist. */
  async loadEvents(sessionId: string): Promise<StoredEvent[]> {
    // Flush any pending writes first so the file is up to date
    await this.flush(sessionId);

    const path = this.filePath(sessionId);
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch {
      return [];
    }

    const events: StoredEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as StoredEvent);
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  }

  /** Check if a JSONL file exists for a session */
  async hasEvents(sessionId: string): Promise<boolean> {
    try {
      await stat(this.filePath(sessionId));
      return true;
    } catch {
      return false;
    }
  }

  /** Delete the JSONL file for a session */
  async cleanup(sessionId: string): Promise<void> {
    // Cancel any pending writes
    const buf = this.pendingBuffers.get(sessionId);
    if (buf) {
      clearTimeout(buf.timer);
      this.pendingBuffers.delete(sessionId);
    }

    try {
      await unlink(this.filePath(sessionId));
    } catch {
      // File may not exist — that's fine
    }
  }

  /** Get the data directory path (for diagnostics) */
  get directory(): string {
    return this.dataDir;
  }
}
