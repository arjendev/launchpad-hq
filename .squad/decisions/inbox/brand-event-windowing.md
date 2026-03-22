# Decision: Event Processing Extraction & Windowed Rendering

**Author:** Brand  
**Date:** 2026-session-events  
**Status:** Implemented

## Context

The ~400-line WebSocket event handler in `conversation-hooks.ts` was the only path for converting SDK events into `ConversationEntry[]`. When a client re-attached to a session, only basic REST messages were available — all rich events (tool calls, intents, subagent activity) were lost.

## Decision

1. **Extracted event processing** into `src/client/services/event-processor.ts` with a dual-mode processor:
   - `processSessionEvent()` — handles one event with `"live"` or `"batch"` mode
   - `processEventBatch()` — replays an array of historical events into entries
   - Both modes share the same `EventProcessorRefs` cross-event state

2. **New REST hook `useSessionEvents()`** — uses TanStack `useInfiniteQuery` with reverse cursor pagination against `GET /api/copilot/aggregated/sessions/:id/events`. Gracefully degrades to empty when endpoint isn't available yet.

3. **Historical events are authoritative** — when loaded, REST messages only fill timestamps BEFORE the events coverage. This prevents duplicates without complex dedup.

4. **Windowed rendering** — `renderCount` approach (render from tail of entries array). Scroll-up expands window; when all loaded entries are shown and `hasMore` is true, fetches older events from API.

5. **Scroll-to-bottom button** — appears when user scrolls up and new messages arrive. Shows count of new messages.

## Impact

- `conversation-hooks.ts` dropped from ~920 to ~390 lines
- Event processing is now testable independently of React
- Re-attaching clients will see full event history when Romilly's endpoint ships
- No changes to existing rendering — `ConversationEntry` type unchanged
