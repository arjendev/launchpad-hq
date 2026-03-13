/**
 * Local project state tracking for the daemon.
 *
 * Tracks the current ProjectState and detects changes so the client
 * can send status-update messages to HQ only when something changed.
 */

import type { ProjectState, WorkState } from '../shared/protocol.js';

export type StateChangeListener = (state: ProjectState) => void;

export class DaemonState {
  private state: ProjectState;
  private listeners: StateChangeListener[] = [];

  constructor(initial?: Partial<ProjectState>) {
    this.state = {
      initialized: initial?.initialized ?? false,
      daemonOnline: initial?.daemonOnline ?? false,
      workState: initial?.workState ?? 'stopped',
    };
  }

  /** Return a snapshot of the current state */
  get current(): ProjectState {
    return { ...this.state };
  }

  /** Subscribe to state changes */
  onChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Update one or more fields. Notifies listeners only if values actually changed. */
  update(patch: Partial<ProjectState>): void {
    let changed = false;

    for (const key of Object.keys(patch) as (keyof ProjectState)[]) {
      if (patch[key] !== undefined && this.state[key] !== patch[key]) {
        (this.state as unknown as Record<string, unknown>)[key] = patch[key];
        changed = true;
      }
    }

    if (changed) {
      const snapshot = this.current;
      for (const listener of this.listeners) {
        listener(snapshot);
      }
    }
  }

  /** Convenience setters */
  setInitialized(value: boolean): void {
    this.update({ initialized: value });
  }

  setOnline(value: boolean): void {
    this.update({ daemonOnline: value });
  }

  setWorkState(value: WorkState): void {
    this.update({ workState: value });
  }
}
