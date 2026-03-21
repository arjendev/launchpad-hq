# Decision: Extract Workflow Plugin + Typed Event Bus

**Author:** Romilly (Backend Dev)  
**Date:** 2026-03-21  
**Issue:** #76 — Architecture Refactor Phase 1  
**Status:** Implemented  

## Context

`routes/workflow.ts` was a 1,183-line monolith containing route definitions, service
instantiation, Fastify decoration, event wiring, and daemon event listeners. The daemon
registry's event system used raw `EventEmitter` with `as never` casts on every `.emit()`
call (20+ occurrences across handler.ts and consumers).

## Decision

### 1. Typed DaemonEventBus (declaration merging pattern)

Created `daemon-registry/event-bus.ts` with a `DaemonEventMap` interface (23 event types)
and a `DaemonEventBus` class that uses TypeScript declaration merging to provide typed
`on`/`emit` overloads while inheriting EventEmitter runtime behavior. `DaemonRegistry`
now extends `DaemonEventBus` instead of raw `EventEmitter`.

**Trade-off:** Declaration merging requires an eslint-disable comment for
`@typescript-eslint/no-unsafe-declaration-merging`. Accepted because it gives us
compile-time safety on all event arguments with zero runtime overhead.

### 2. Workflow plugin extraction (fp-wrapped)

Extracted service instantiation, Fastify decoration, and event wiring into
`workflow/plugin.ts` wrapped with `fastify-plugin` (fp). The plugin must be registered
before `workflowRoutes` in the server startup sequence.

**Trade-off:** Using fp() means the plugin's decorators are visible globally (not
encapsulated). This is intentional — routes and daemon-events both need access to the
stores.

### 3. Daemon events handler (single broadcast owner)

Extracted all 7 daemon event listeners into `workflow/daemon-events.ts`. This file now
owns ALL workflow browser broadcasts. handler.ts only emits to the typed event bus.

**Trade-off:** Browser broadcast logic is now further from the message parsing. Accepted
because it eliminates duplicate broadcasts and makes broadcast logic testable alongside
the business logic.

## Consequences

- All `as never` casts eliminated from handler.ts and copilot-aggregator
- routes/workflow.ts reduced from 1,183 to 889 lines (pure route definitions)
- New event types only need to be added to `DaemonEventMap` — compiler catches
  mismatches everywhere
- Test setup requires registering `workflowPlugin` before `workflowRoutes`

## Risks

- **Fastify encapsulation quirk**: Destructuring Fastify decorators in non-fp plugins
  creates stale references when fp-wrapped plugins update them. Mitigated by using
  explicit property access (`server.workflowStore` not `const { workflowStore } = server`).
