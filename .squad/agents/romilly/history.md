# Romilly — History

## Core Context

### Architecture (post-#76 refactor)
- **Workflow plugin pattern**: `workflow/plugin.ts` creates services + decorates Fastify. `workflow/daemon-events.ts` handles daemon events. `routes/workflow.ts` is thin routes only.
- **Typed event bus**: `DaemonEventBus` in `daemon-registry/event-bus.ts` with `DaemonEventMap`. DaemonRegistry extends it. Zero `as never` casts.
- **Plugin registration order**: workflow plugin BEFORE workflow routes (decorators must exist before routes consume them)
- **State service**: dual backend (GitStateManager for GitHub repo, LocalStateManager for filesystem). Hot-swap via `reinitializeStateService()`.
- **WorkflowStore**: in-memory + periodic flush to enrichment.json. Load resets coordinator to idle but preserves sessionId.

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

### Test Infrastructure
- `createTestServer()` in `src/test-utils/server.ts` — lightweight Fastify for injection tests.
- Fake services: `fakeStateService()`, `fakeWs()`, `fakeDaemonRegistry()` (EventEmitter + mocks).
- Tests use `server.inject()` for HTTP + `registry.emit()` for daemon events.
- State machine tests validate transitions and terminal states.

### Removed Modules
- `attention/` — removed in Phase 4 (rule engine, periodic evaluation)
- `routes/inbox.ts` + InboxPanel — removed in Phase 4 (superseded by workflow)
