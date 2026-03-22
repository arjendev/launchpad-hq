# Romilly — History

## Core Context

### Architecture (post-#76 refactor)
- **Workflow plugin pattern**: `workflow/plugin.ts` creates services + decorates Fastify. `workflow/daemon-events.ts` handles daemon events. `routes/workflow.ts` is thin routes only.
- **Typed event bus**: `DaemonEventBus` in `daemon-registry/event-bus.ts` with `DaemonEventMap`. DaemonRegistry extends it. Zero `as never` casts.
- **Plugin registration order**: workflow plugin BEFORE workflow routes (decorators must exist before routes consume them)
- **State service**: dual backend (GitStateManager for GitHub repo, LocalStateManager for filesystem). Hot-swap via `reinitializeStateService()`.
- **WorkflowStore**: in-memory + periodic flush to enrichment.json. Load resets coordinator to idle but preserves sessionId.

### Observability (#59)
- **OTEL tracing**: `src/server/observability/tracing.ts` — opt-in via `LaunchpadConfig.otel.enabled`. Dynamic imports ensure zero overhead when disabled. `setupTracing()` must run BEFORE Fastify creation.
- **OTEL plugin**: `src/server/observability/plugin.ts` — Fastify plugin adding `request.traceId` decorator and per-request spans. Registered after websocket, before auth.
- **Structured logger**: `src/server/observability/logger.ts` — `createLogger(name)` with trace context injection and `sanitize()` for stripping sensitive fields.
- **Instrumented paths**: daemon WS handler (per-message spans), workflow daemon-events (coordinator/progress/completion spans), copilot-aggregator (session-event spans), GitHub GraphQL (per-operation spans), GitHub REST (tracedFetch wrapper).
- **Trace context propagation**: `registry.sendToDaemon()` and `broadcastToDaemons()` inject W3C `traceparent` into HQ→daemon messages.
- **Config**: `LaunchpadConfig.otel?: { enabled, endpoint, serviceName }`. CLI flags `--otel` and `--otel-endpoint` override config.json.
- **OTEL packages**: `@opentelemetry/*` packages need `ssr.external: [/^@opentelemetry\//]` in vitest.config.ts to avoid Vite import resolution failures.
- **Jaeger**: `docker compose up -d` starts the collector + UI. Jaeger UI on :16686, OTLP gRPC on :4317.

### Patterns
- Route files: validate request → call service → respond. No business logic, no event wiring.
- Plugins own their services via `fp()` wrapper and `decorate()`.
- GitHub API calls centralized in `github/rest.ts` and `github/graphql.ts` — not inline in routes.
- Shared helpers in `utils/validation.ts` (isValidOwnerRepo, deriveDaemonStatus, deriveDaemonInfo).
- Terminal state encapsulated in TerminalTracker class as Fastify decorator.

### Gotchas
- Dual store bug: if both plugin AND routes create WorkflowStore instances, daemon events write to one store while routes read another. Plugin creates, routes destructure from `server`.
- `fp()` wrapper required on plugins for decorator visibility in parent scope.
- Tests need `await server.register(workflowPlugin)` BEFORE `workflowRoutes`.
- `coordinatorStarted()` only works from "starting" state — test must POST /start first then emit event.
- report_progress(completed) → HQ marks issue done via copilot:tool-invocation handler in daemon-events.ts.
- `@opentelemetry/resources` v2 exports `resourceFromAttributes()` not `new Resource()` — the class is type-only.

### Test Infrastructure
- `createTestServer()` in `src/test-utils/server.ts` — lightweight Fastify for injection tests.
- Fake services: `fakeStateService()`, `fakeWs()`, `fakeDaemonRegistry()` (EventEmitter + mocks).
- Tests use `server.inject()` for HTTP + `registry.emit()` for daemon events.
- State machine tests validate transitions and terminal states.

### Removed Modules
- `attention/` — removed in Phase 4 (rule engine, periodic evaluation)
- `routes/inbox.ts` + InboxPanel — removed in Phase 4 (superseded by workflow)

## Learnings

### Event persistence (session event log)
- The aggregator now stores all raw session events in-memory via `eventLogs: Map<string, StoredEvent[]>`, capped at 10,000 per session.
- `handleSessionEvent()` stores SDK events; `handleToolInvocation()` stores synthetic `copilot:tool-invocation` events alongside them.
- `getEvents(sessionId, before?, limit?)` provides paginated retrieval — chronological order within a page, backward pagination via `before` cursor.
- REST endpoint: `GET /api/copilot/aggregated/sessions/:sessionId/events` with `?before=ISO&limit=N` query params.
- SDK event timestamps can be technically invalid ISO strings (e.g. `17:52:60` — 60 seconds). Stored timestamps prefer the raw string to avoid `RangeError` from `new Date(NaN).toISOString()`. The `getEvents()` comparisons still work because lexicographic ISO comparison handles this.
- Event logs are cleaned up in both `removeSession()` and `removeDaemon()`, mirroring conversation history and tool invocations.

### Cross-Agent Notes (2026-03-22)

#### Brand's Event Processing Integration (commit 57d821d)
- Client extracted event processing into `src/client/services/event-processor.ts` with dual-mode processor
- `processSessionEvent()` handles live or batch mode; `processEventBatch()` replays historical events
- Both modes share `EventProcessorRefs` state for cross-event refs (toolStarts, subagentStack, etc.)
- `useSessionEvents()` hook uses TanStack `useInfiniteQuery` with reverse cursor pagination against our REST endpoint
- Historical events are authoritative for their time range — REST messages only fill timestamps BEFORE event coverage
- Windowed rendering with scroll-to-bottom button; expands window when scrolling up
- Integrated successfully with commit 57d821d, consuming our `52b7d8b` endpoint

### Event disk persistence (commit 391af12)
- `EventPersistence` class in `src/server/copilot-aggregator/event-persistence.ts` handles all JSONL file I/O
- Files stored at `~/.launchpad/session-events/{sessionId}.jsonl` — one JSON object per line
- Buffered writes: events queue in memory, flushed every 100ms or 10 events (configurable)
- `appendEvent()` is fire-and-forget (sync call queues to buffer), `flush()` / `flushAll()` are async
- SessionId sanitized to `[a-zA-Z0-9_-]` to prevent path traversal
- Aggregator accepts optional `EventPersistence` via constructor — no persistence = pure in-memory (backward compatible)
- `getEvents()` is now async (returns `Promise<PaginatedEvents>`). Lazy hydration: first call per session loads from disk via `hydrateFromDisk()`, tracked by `hydratedSessions` Set
- `storeEvent()` appends to both in-memory log AND disk (fire-and-forget)
- `cleanupSessionEvents(sessionId)` immediately deletes the file; `scheduleEventCleanup()` delays 30s
- `removeSession()` and `removeDaemon()` schedule cleanup with delay so clients can load final events
- Plugin creates `EventPersistence` in production; skips in VITEST to avoid cross-test file leaks
- `flushEvents()` called in onClose hook to flush pending writes on shutdown
- 17 unit tests for EventPersistence, 2 integration tests for aggregator + disk round-trip

