# Decision: Typed Event Bus Integration (Phase 3, #76)

**Author:** TARS  
**Date:** 2026-03-21  
**Status:** Implemented

## Context

Phase 1+2 created `DaemonEventBus` with a typed `DaemonEventMap` interface but it wasn't fully integrated — `DaemonRegistry` still extended plain `EventEmitter`, consumers had manual type annotations, and terminal message types were potentially duplicated.

## Decisions

### 1. DaemonRegistry extends DaemonEventBus (not EventEmitter)
All event typing flows through `DaemonEventMap`. The old `DaemonRegistryEvents` interface was removed — it was redundant since `DaemonEventMap` already covers `daemon:connected` and `daemon:disconnected`.

### 2. Consumers infer types from the event map
Listeners in `copilot-aggregator/plugin.ts` no longer declare explicit parameter types. TypeScript infers them from `DaemonEventMap`, so type drift between emitters and listeners is caught at compile time.

### 3. Preview events have typed payloads
`preview:proxy-response`, `preview:ws-data`, and `preview:ws-close` were originally `[payload: unknown]`. Now they use `PreviewProxyResponsePayload`, `PreviewWsDataPayload`, and `PreviewWsClosePayload` — matching the protocol message shapes.

### 4. `copilot:sdk-state` payload matches protocol
The event map originally declared `{ projectId: string; state: unknown; error?: string }` but the protocol's `CopilotSdkStateMessage` doesn't include `projectId`. Fixed to `{ state: unknown; error?: string }`.

### 5. Terminal types are intentionally distinct (no consolidation)
- `ws/types.ts`: Browser→HQ messages — carry `daemonId`, flat structure, used by ConnectionManager
- `shared/protocol.ts`: HQ→daemon messages — carry `projectId` + `sessionId`, extend `BaseMessage`

Same *concept* (terminal input/resize), different *audiences* and *wire formats*. Documented in both files with cross-references.

## Impact
- Zero `as never` casts in handler.ts (was 20 before Phase 2)
- Zero `as never` casts for event bus in copilot-aggregator/plugin.ts
- Type-safe emit/listen across the entire daemon event pipeline
- Any event signature mismatch is now a compile-time error
