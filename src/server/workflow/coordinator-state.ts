/**
 * Coordinator Session State Management
 *
 * Tracks the coordinator lifecycle per project: session ID, status,
 * dispatch history. Persisted alongside project state in the workflow store.
 */

import type {
  CoordinatorStatus,
  CoordinatorProjectState,
  DispatchRecord,
  DispatchStatus,
} from "../../shared/protocol.js";

export function defaultCoordinatorState(): CoordinatorProjectState {
  return {
    status: "idle",
    sessionId: null,
    lastSeenAt: null,
    startedAt: null,
    error: null,
    dispatches: [],
  };
}

// --- Coordinator lifecycle ---

export function coordinatorStarting(state: CoordinatorProjectState): CoordinatorProjectState {
  return {
    ...state,
    status: "starting",
    error: null,
    startedAt: new Date().toISOString(),
  };
}

export function coordinatorStarted(
  state: CoordinatorProjectState,
  sessionId: string,
): CoordinatorProjectState {
  return {
    ...state,
    status: "active",
    sessionId,
    lastSeenAt: new Date().toISOString(),
    error: null,
  };
}

export function coordinatorCrashed(
  state: CoordinatorProjectState,
  error: string,
): CoordinatorProjectState {
  return {
    ...state,
    status: "crashed",
    error,
    lastSeenAt: new Date().toISOString(),
  };
}

export function coordinatorStopped(state: CoordinatorProjectState): CoordinatorProjectState {
  return {
    ...state,
    status: "idle",
    // Preserve sessionId for resume on next start
    startedAt: null,
    error: null,
  };
}

export function coordinatorHealthPing(state: CoordinatorProjectState): CoordinatorProjectState {
  return {
    ...state,
    lastSeenAt: new Date().toISOString(),
  };
}

// --- Dispatch tracking ---

export function addDispatch(
  state: CoordinatorProjectState,
  issueNumber: number,
): CoordinatorProjectState {
  const record: DispatchRecord = {
    issueNumber,
    status: "pending",
    dispatchedAt: new Date().toISOString(),
  };
  return {
    ...state,
    dispatches: [...state.dispatches, record],
  };
}

export function updateDispatchStatus(
  state: CoordinatorProjectState,
  issueNumber: number,
  status: DispatchStatus,
  error?: string,
): CoordinatorProjectState {
  const dispatches = state.dispatches.map((d) => {
    if (d.issueNumber !== issueNumber) return d;
    return {
      ...d,
      status,
      ...(status === "completed" || status === "failed"
        ? { completedAt: new Date().toISOString() }
        : {}),
      ...(error ? { error } : {}),
    };
  });
  return { ...state, dispatches };
}

export function getDispatch(
  state: CoordinatorProjectState,
  issueNumber: number,
): DispatchRecord | undefined {
  return state.dispatches.find((d) => d.issueNumber === issueNumber);
}

export function getActiveDispatches(state: CoordinatorProjectState): DispatchRecord[] {
  return state.dispatches.filter(
    (d) => d.status === "pending" || d.status === "in-progress",
  );
}

export function isCoordinatorReady(status: CoordinatorStatus): boolean {
  return status === "active";
}
