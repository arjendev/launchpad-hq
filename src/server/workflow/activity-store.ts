/**
 * Activity Feed Store
 *
 * In-memory ring buffer for activity events. Stores last 500 events per project
 * and last 1000 events globally. Supports pagination, filtering by type and
 * since-timestamp.
 */

import { randomUUID } from "node:crypto";

// --- Types ---

export type ActivityEventType =
  | "issue-dispatched"
  | "progress"
  | "elicitation-requested"
  | "elicitation-answered"
  | "elicitation-timeout"
  | "issue-completed"
  | "coordinator-started"
  | "coordinator-crashed"
  | "review-approved"
  | "review-rejected";

export type ActivitySeverity = "info" | "warning" | "urgent";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: ActivityEventType;
  projectOwner: string;
  projectRepo: string;
  issueNumber?: number;
  message: string;
  severity: ActivitySeverity;
}

export interface ActivityQuery {
  since?: string;
  limit?: number;
  types?: ActivityEventType[];
}

export interface PaginatedActivityResult {
  events: ActivityEvent[];
  total: number;
  hasMore: boolean;
}

// --- Ring Buffer ---

class RingBuffer<T> {
  private buffer: T[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.buffer = new Array<T>(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Return items in insertion order (oldest first). */
  toArray(): T[] {
    if (this.count === 0) return [];
    if (this.count < this.capacity) {
      return this.buffer.slice(0, this.count);
    }
    // Buffer is full — head points to the oldest item
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ];
  }

  /** Return items in reverse insertion order (newest first). */
  toReversed(): T[] {
    return this.toArray().reverse();
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = new Array<T>(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

// --- Store ---

const DEFAULT_PROJECT_CAPACITY = 500;
const DEFAULT_GLOBAL_CAPACITY = 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class ActivityStore {
  private projectBuffers = new Map<string, RingBuffer<ActivityEvent>>();
  private globalBuffer: RingBuffer<ActivityEvent>;
  private listeners: Array<(event: ActivityEvent) => void> = [];

  constructor(
    private readonly projectCapacity = DEFAULT_PROJECT_CAPACITY,
    private readonly globalCapacity = DEFAULT_GLOBAL_CAPACITY,
  ) {
    this.globalBuffer = new RingBuffer<ActivityEvent>(globalCapacity);
  }

  /** Register a listener called on every new event. */
  onEvent(listener: (event: ActivityEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Emit a new activity event. */
  emit(
    params: Omit<ActivityEvent, "id" | "timestamp">,
  ): ActivityEvent {
    const event: ActivityEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...params,
    };

    // Push to project buffer
    const key = projectKey(params.projectOwner, params.projectRepo);
    let projectBuf = this.projectBuffers.get(key);
    if (!projectBuf) {
      projectBuf = new RingBuffer<ActivityEvent>(this.projectCapacity);
      this.projectBuffers.set(key, projectBuf);
    }
    projectBuf.push(event);

    // Push to global buffer
    this.globalBuffer.push(event);

    // Notify listeners
    for (const listener of this.listeners) {
      listener(event);
    }

    return event;
  }

  /** Query global activity feed (newest first). */
  getGlobal(query: ActivityQuery = {}): PaginatedActivityResult {
    return this.queryBuffer(this.globalBuffer, query);
  }

  /** Query project-specific activity feed (newest first). */
  getByProject(owner: string, repo: string, query: ActivityQuery = {}): PaginatedActivityResult {
    const key = projectKey(owner, repo);
    const buf = this.projectBuffers.get(key);
    if (!buf) {
      return { events: [], total: 0, hasMore: false };
    }
    return this.queryBuffer(buf, query);
  }

  /** Get all known project keys. */
  getProjectKeys(): string[] {
    return [...this.projectBuffers.keys()];
  }

  /** Total events in global buffer. */
  get globalSize(): number {
    return this.globalBuffer.size;
  }

  /** Total events in a project buffer. */
  projectSize(owner: string, repo: string): number {
    const key = projectKey(owner, repo);
    return this.projectBuffers.get(key)?.size ?? 0;
  }

  private queryBuffer(
    buffer: RingBuffer<ActivityEvent>,
    query: ActivityQuery,
  ): PaginatedActivityResult {
    let events = buffer.toReversed();

    // Filter by since timestamp
    if (query.since) {
      const sinceTime = new Date(query.since).getTime();
      events = events.filter((e) => new Date(e.timestamp).getTime() > sinceTime);
    }

    // Filter by types
    if (query.types && query.types.length > 0) {
      const typeSet = new Set(query.types);
      events = events.filter((e) => typeSet.has(e.type));
    }

    const total = events.length;
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const limited = events.slice(0, limit);

    return {
      events: limited,
      total,
      hasMore: total > limit,
    };
  }
}

function projectKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}
