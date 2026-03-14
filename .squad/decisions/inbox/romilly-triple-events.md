# Decision: Triple Event Fix — CopilotManager Dedup Guards

**By:** Romilly (Backend Dev)
**Date:** 2026-03-14
**Status:** Implemented

## Context

After the previous duplicate-event fix (commit e0ca69f addressed 4 causes), users still reported 3× duplicate entries in the session conversation viewer — this time with DIFFERENT timestamps, meaning the daemon was genuinely creating 3 separate events per SDK event.

## Root Causes Found

1. **`client.on()` duplicated `session.on()`** — `CopilotManager.start()` registered a client-level catch-all listener that fired for per-session events already covered by the dedicated `session.on()` in `trackSession()`. Each generated events with independently created timestamps.

2. **`start()` not idempotent** — When the daemon reconnected to HQ (e.g., HQ restart during dev), `start()` was called again without a guard. Each call leaked an additional `client.on()` listener. After one reconnect: 2 `client.on()` + 1 `session.on()` = 3× events.

3. **Explicit synthetic events doubled `session.start`** — `handleCreateSession` and `handleResumeSession` sent synthetic `session.start` events (carrying the `requestId` needed for correlation) while `session.on()` also forwarded the SDK's native `session.start`.

## Changes

- `CopilotManager.start()`: Early return if `this.started` is true (idempotent)
- `client.on()` handler: Skips events where `sessionId` exists in `activeSessions` (per-session listener already covers those)
- `trackSession(session, skipInitialStart)`: New param suppresses first `session.start` from `session.on()` when create/resume already sent it explicitly
- `trackSession()`: Cleans up any pre-existing unsubscriber for the same sessionId before attaching a new one

## Impact

- All session events now fire exactly 1× regardless of reconnects
- `session.start` fires 1× (the explicit synthetic with `requestId`)
- No listener leaks on daemon reconnect
- 3 new unit tests + 1 E2E test added

## Files Changed

- `src/daemon/copilot/manager.ts` — Core fix (4 changes)
- `src/daemon/copilot/__tests__/manager.test.ts` — 3 dedup regression tests
- `tests/e2e/sdk-session-duplicates.spec.ts` — E2E duplicate detection test
