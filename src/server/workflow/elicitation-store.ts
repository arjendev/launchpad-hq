/**
 * Elicitation Store
 *
 * In-memory store for pending elicitation requests relayed from daemons.
 * Each elicitation is keyed by elicitationId and tracks its lifecycle:
 * pending → answered | timeout.
 *
 * Answered/timed-out entries are automatically cleaned up after 1 hour.
 */

import { ELICITATION_TIMEOUT_MS, ELICITATION_CLEANUP_MS } from "../../shared/constants.js";
import type { ElicitationSchema } from "../../shared/protocol.js";

// --- Types ---

export type ElicitationStatus = "pending" | "answered" | "timeout";

export interface PendingElicitation {
  id: string;
  sessionId: string;
  projectId: string;
  message: string;
  mode?: "form";
  requestedSchema: ElicitationSchema;
  issueNumber?: number;
  status: ElicitationStatus;
  createdAt: number;
  answeredAt?: number;
  response?: Record<string, unknown>;
}

export type ElicitationTimeoutCallback = (elicitation: PendingElicitation) => void;

// --- Store ---

export class ElicitationStore {
  private elicitations = new Map<string, PendingElicitation>();
  private timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private onTimeoutCallback: ElicitationTimeoutCallback | null = null;

  constructor(
    private readonly timeoutMs: number = ELICITATION_TIMEOUT_MS,
    private readonly cleanupMs: number = ELICITATION_CLEANUP_MS,
  ) {
    // Periodically clean up resolved elicitations
    if (this.cleanupMs > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupResolved();
      }, this.cleanupMs);
    }
  }

  /** Register a callback invoked when an elicitation times out. */
  onTimeout(callback: ElicitationTimeoutCallback): void {
    this.onTimeoutCallback = callback;
  }

  /** Add a new pending elicitation. Returns false if the id already exists. */
  add(elicitation: Omit<PendingElicitation, "status" | "createdAt">): PendingElicitation {
    const entry: PendingElicitation = {
      ...elicitation,
      status: "pending",
      createdAt: Date.now(),
    };

    this.elicitations.set(entry.id, entry);

    // Schedule timeout
    if (this.timeoutMs > 0) {
      const timer = setTimeout(() => {
        this.handleTimeout(entry.id);
      }, this.timeoutMs);
      this.timeoutTimers.set(entry.id, timer);
    }

    return entry;
  }

  /** Get an elicitation by id. */
  get(id: string): PendingElicitation | undefined {
    return this.elicitations.get(id);
  }

  /** Get all elicitations, optionally filtered by status. */
  getAll(status?: ElicitationStatus): PendingElicitation[] {
    const all = [...this.elicitations.values()];
    return status ? all.filter((e) => e.status === status) : all;
  }

  /** Get pending elicitations for a specific project. */
  getByProject(projectId: string): PendingElicitation[] {
    return [...this.elicitations.values()].filter(
      (e) => e.projectId === projectId && e.status === "pending",
    );
  }

  /**
   * Mark an elicitation as answered.
   * Returns the updated elicitation, or undefined if not found or not pending.
   */
  answer(id: string, response: Record<string, unknown>): PendingElicitation | undefined {
    const entry = this.elicitations.get(id);
    if (!entry || entry.status !== "pending") return undefined;

    entry.status = "answered";
    entry.response = response;
    entry.answeredAt = Date.now();

    // Cancel timeout timer
    const timer = this.timeoutTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(id);
    }

    return entry;
  }

  /** Remove resolved (answered/timed-out) elicitations older than cleanupMs. */
  cleanupResolved(): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, entry] of this.elicitations) {
      if (entry.status === "pending") continue;
      const resolvedAt = entry.answeredAt ?? entry.createdAt;
      if (now - resolvedAt >= this.cleanupMs) {
        this.elicitations.delete(id);
        this.timeoutTimers.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /** Number of entries in the store. */
  get size(): number {
    return this.elicitations.size;
  }

  /** Shut down: clear all timers. */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.timeoutTimers.clear();
  }

  /** Handle timeout for a specific elicitation. */
  private handleTimeout(id: string): void {
    const entry = this.elicitations.get(id);
    if (!entry || entry.status !== "pending") return;

    entry.status = "timeout";
    entry.answeredAt = Date.now();
    this.timeoutTimers.delete(id);

    if (this.onTimeoutCallback) {
      this.onTimeoutCallback(entry);
    }
  }
}
