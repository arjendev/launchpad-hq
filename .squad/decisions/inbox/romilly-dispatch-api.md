# Decision: Dispatch API, Session Persistence, and Commit Tracking (#72)

**Author:** Romilly (Backend Dev)
**Date:** 2026-03-20
**Status:** Implemented

## Context

Phase 2 (#72) requires HQ to manage coordinator sessions per project, dispatch issues to the coordinator daemon, track commits back to issues, and stream progress to connected browser clients.

## Decisions

### 1. Pure Function Coordinator State
Coordinator lifecycle is managed through pure functions (`coordinatorStarting`, `coordinatorStarted`, etc.) that take current state and return new state. This is immutable and easily testable without mocking. Dispatch records are embedded in the coordinator state for atomicity.

### 2. CommitTracker with Dual Indexing
Commits are indexed both by project (for listing) and by project+issue (for lookup). SHA-based deduplication prevents double-counting when both progress and completion events report the same commit. The parser uses a single regex with alternation for `fixes|closes|resolves` patterns.

### 3. Daemon Events via EventEmitter
The workflow route plugin listens on the daemonRegistry's EventEmitter for `workflow:*` events emitted by the DaemonWsHandler. This keeps the handler thin (just route and broadcast) while the workflow plugin owns the state mutations. No new plugin dependencies were needed.

### 4. Test Strategy: HTTP + Events, No Plugin Internals
Tests interact with the server exclusively through `server.inject()` for HTTP and `registry.emit()` for daemon events. The `activateCoordinator()` helper simulates the daemon started flow. This respects Fastify's encapsulation — the workflowStore is never accessed directly from tests.

### 5. Dispatch Validation Guards
Dispatch requires: (1) issue exists, (2) issue is in `backlog` state, (3) coordinator is `active`. The issue transitions to `in-progress` before the daemon message is sent, ensuring consistent state even if the daemon message delivery is slow.

## Files Changed
- `src/server/workflow/coordinator-state.ts` — new
- `src/server/workflow/commit-tracker.ts` — new
- `src/server/workflow/store.ts` — extended
- `src/server/routes/workflow.ts` — extended
- `src/server/workflow/__tests__/coordinator-state.test.ts` — new (17 tests)
- `src/server/workflow/__tests__/commit-tracker.test.ts` — new (22 tests)
- `src/server/workflow/__tests__/dispatch-api.test.ts` — new (23 tests)

## Test Coverage
62 new tests. All 1170 tests passing. No new type errors.
