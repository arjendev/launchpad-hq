# Project Context

- **Owner:** Arjen
- **Project:** launchpad — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Potentially leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, npx CLI, Terminal/Web UI, GitHub API, Copilot SDK, Devcontainer API
- **Created:** 2026-03-13

## Core Context

**Phase 1 Backend Foundation:** Romilly delivered 49 tests across three core systems. Issue #2 established Fastify skeleton with plugin pattern, CORS, static serving, graceful shutdown. Issue #7 implemented GitHub REST API endpoints (issues, PRs, overview, dashboard) with GraphQL integration and error mapping. Issue #12 built Project CRUD API (add, list, remove, update, discover) with GitHub validation and enrichment cleanup. Issue #13 created WebSocket server with ConnectionManager, channel subscriptions, heartbeat monitoring, and decorator pattern for broadcast.

**Phase 2 Server Intelligence:** Issue #18 implemented attention system (rule-based alerting). Rules: evaluateStaleIssues (configurable staleDays, escalates to critical at 2×), evaluatePrNeedsReview, stubs for CI-failing and session-idle. Manager uses in-memory Map with configurable maxItems/LRU eviction. Periodic evaluation via setInterval scans all tracked projects. Dismissal state persists across cycles. REST endpoints: GET /api/attention (filterable), GET /api/attention/count (unread + severity breakdown), POST /api/attention/:id/dismiss. WebSocket broadcasts on "attention" channel. 35 new tests.

**Wave 1 Registry & Integration:** Issue #34 completed daemon registry (33 tests). DaemonRegistry tracks connected daemons (register/unregister/heartbeat/sendTo/broadcast). DaemonWsHandler manages auth handshake (challenge/response + nonce validation). Separate `/ws/daemon` path with own WebSocketServer. Message routing: register/heartbeat/status-update/terminal-data/copilot-*/attention-*. REST API: GET /api/daemons, GET /api/daemons/:id, POST /api/daemons/:id/command. Fixed critical bug: removed socket.destroy() from browser WS plugin that was killing daemon connections.

**Test Coverage:** 49 Phase 1 + 35 Phase 2 + 33 Wave 1 = 117 total new tests. 351 integrated tests passing. All Phase 1 issues (#7, #12, #13, #18, #34) closed.

**Key Patterns:**
- Fastify plugin pattern: FastifyPluginAsync exported from route files, registered in index.ts with dependency ordering
- Promise.allSettled for graceful per-project failures (don't let one bad repo break dashboard)
- Rule engine uses pure functions — testable without mocking
- Manager uses SHA-256 deterministic IDs for stable deduplication across evaluation cycles
- Dismissal state persists in-memory between evaluations
- WebSocket: separate paths with separate upgrade handlers (don't destroy non-matching sockets)
- Auth handshake: challenge (with nonce) + response (token + nonce) + accept/reject

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-15: State management split — LocalStateManager + GitStateManager
- StateManager refactored to support pluggable backends (offline vs. cloud-sync modes)
- LocalStateManager: `~/.launchpad/config.json`, fire-and-forget, offline-first
- GitStateManager: `launchpad-state` repo via GitHub API, multi-device sync
- LaunchpadConfig type centralized in `src/server/state/types.ts` and shared with onboarding wizard
- Settings API: GET/PUT `/api/settings` with validation
- Cross-agent: Brand's wizard saves via Romilly's settings endpoint; TARS tunnel config exposed here

- **SDK messages lack projectId:** Daemon `CopilotManager` sends `copilot-sdk-session-event` and `copilot-sdk-session-list` without `projectId` in the payload (unlike the non-SDK `copilot-session-*` messages which include it). The `DaemonWsHandler` must inject `projectId` from `wsToDaemonId` mapping when relaying SDK messages to the registry. Fixed in handler.ts by spreading `projectId: this.wsToDaemonId.get(ws)` into the payload.
- **daemonId === projectId:** Throughout the codebase, `daemonId` is the `owner/repo` string and is interchangeable with `projectId`. The aggregator stub session creation previously used `"unknown"` as fallback — changed to use `daemonId` directly since they're the same value.
- **Silent catch anti-pattern:** `CopilotManager.pollSessions` was swallowing errors silently. Added `console.warn` for visibility. Silent catches hide production issues — always log at minimum warn level.
- **Duplicate SDK events root cause:** Four contributing factors: (1) `selectSession` called `resumeSession` unconditionally — even re-selecting the same session fired another resume, accumulating daemon-side event listeners. (2) Only CLI sessions were disconnected on switch-away — SDK sessions never got cleanup. (3) WebSocket client `createSocket()` didn't null old socket handlers, allowing brief duplicate message dispatch during reconnect. (4) Realtime conversation entries lacked id-based dedup. Fix: guard same-session resume, disconnect all types on switch, null old WS handlers, add id-based dedup.
- **Resume route pattern — disconnect-before-resume:** Server-side safeguard: the resume endpoint now sends `copilot-disconnect-session` before `copilot-resume-session`. This ensures clean daemon state regardless of client behavior. Belt-and-suspenders against stale event listeners.
- **Project-scoped SDK agent preference:** Persist the remembered Copilot SDK agent on each `ProjectEntry` as `defaultCopilotSdkAgent`, with `null` meaning "use the default agent". Expose a project-scoped GET/PUT route that merges this stored preference with whatever agent catalog the daemon advertises, and only inject `config.agent` into create-session when the caller explicitly chose one or a remembered non-null preference exists.

### 2026-03-15: Server-side auth + security hardening (#61)
- **Auth middleware:** `src/server/auth/plugin.ts` — Fastify plugin using `onRequest` hook. Protects all `/api/*` and `/preview/*` routes with `Authorization: Bearer <hqToken>` or `?token=<hqToken>`. Exempt: `/api/health`. Depends on `websocket` plugin for `sessionToken` decorator. Registered in `index.ts` after websocket, before routes.
- **Token leakage fix:** Removed `sessionToken` from `GET /api/settings` response. Client now receives token only from URL query param.
- **WS Origin validation (H3):** Added `isAllowedOrigin()` to `ws/plugin.ts`. Validates Origin header on browser WS upgrade — allows `localhost:*`, `127.0.0.1:*`, and the active tunnel URL. Rejects unknown origins with 403.
- **CORS in production (M8):** `@fastify/cors` now registered in all modes (was dev-only). Dynamic origin callback allows localhost, loopback, and the active tunnel URL hostname. Non-browser requests (no origin) pass through.
- **Security headers (L1):** Installed `@fastify/helmet`. CSP allows `'self'` + `'unsafe-inline'` for scripts/styles (Vite + Mantine need inline), `ws:` + `wss:` for connect-src, `frame-ancestors: 'none'` (equivalent to X-Frame-Options: DENY).
- **Preview port validation (M1):** `isValidPreviewPort()` in `preview.ts` rejects ports < 1024, > 65535, non-integers, and a blocklist of 14 infrastructure ports (SSH, PostgreSQL, Redis, Elasticsearch, MongoDB, etc.). Applied to both the start endpoint and the proxy route.
- **File permissions (M4):** `local-state-manager.ts` and `launchpad-config.ts` now set `mode: 0o700` on directories and `mode: 0o600` on files when writing state.
- **0.0.0.0 comment (H6):** Added detailed comment in `config.ts` explaining why 0.0.0.0 is safe in devcontainers (Docker bridge isolation + auth middleware + CORS + WS auth).
- **Startup URL:** Console output now prints `?token=<hqToken>` so the user can click to open the authenticated URL.
- **Tests:** 23 new tests (11 auth middleware + 12 port validation). Total: 1013 passing.
- **Coordination:** Brand is doing client-side auth simultaneously — no `src/client/` files touched. TARS is doing daemon hardening — no `src/daemon/` files touched.

### 2026-03-15: Onboarding CLI/UI flow choice (#68)
- **CLI entry point** (`src/cli.ts`): On first run, prompts user "Terminal (CLI)" vs "Browser (Web UI)" via `@clack/prompts` select before running wizard or booting server.
- **CLI path**: Runs existing `runOnboardingWizard()` (terminal wizard with @clack/prompts steps).
- **Browser path**: Sets `LAUNCHPAD_OPEN_ONBOARDING=true` env var, boots server, then opens `/onboarding?token=<token>` in the default browser via `xdg-open`/`open`/`start`. URL also printed to console as fallback.
- **Non-TTY fallback**: Skips the choice prompt and runs wizard in non-interactive mode (applies defaults).
- **Server side** (`src/server/index.ts`): `tryOpenBrowser()` utility added — cross-platform, silent failure. Called from `start()` after server is listening.
- **Both paths produce identical `LaunchpadConfig`** in `~/.launchpad/config.json` with `onboardingComplete: true`.

### 2026-03-13: Phase 1 Summary

**Completed Issues:** #7, #12, #13 (3/8 Phase 1 items)  
**Total Tests Added:** 19 + 16 + 14 = 49 tests  
**Commits:** 3 (REST API, project CRUD, WebSocket server)  

Romilly delivered the complete backend API surface for launchpad:
1. **REST API endpoints** — github-data.ts routes for issues, PRs, overview, dashboard with GraphQL integration
2. **Project CRUD API** — full lifecycle management with GitHub validation, discovery endpoint, enrichment cleanup
3. **WebSocket server** — channel-based messaging with connection tracking, heartbeat monitoring, broadcast capability

All three modules are integrated into the server with correct plugin registration order. The state plugin (TARS #10) was wired into index.ts, unblocking project routes. GitHub GraphQL plugin (TARS #6) was wired into index.ts, enabling data endpoints.

Romilly's work is the bridge between TARS' data access layer and Brand's frontend. All issues closed on GitHub.

### 2026-03-13: Attention system — data model & server logic (#18)
- **Module:** `src/server/attention/` — types, rules engine, manager, Fastify plugin, barrel export.
- **Types:** `AttentionItem` (id, type, severity, project, message, timestamp, url, sourceId, dismissed). `AttentionType`: issue_stale, pr_needs_review, ci_failing, session_idle. `AttentionSeverity`: info, warning, critical.
- **Rule engine:** `rules.ts` — pure functions: `evaluateStaleIssues` (configurable staleDays, escalates to critical at 2× threshold), `evaluatePrNeedsReview` (open non-draft PRs), `evaluateCiFailing` (stub — needs checks API), `evaluateSessionIdle` (stub — needs Copilot SDK #15). `evaluateRules()` orchestrates all enabled rules. `evaluateProjectAttention()` fetches data via GraphQL then evaluates.
- **Manager:** `AttentionManager` class — in-memory Map store, configurable maxItems with LRU eviction (dismissed first). `list()` with filtering (severity, project, type, dismissed) and sorting (severity → date). `dismiss()`, `unreadCount()`, `unreadCountBySeverity()`.
- **Evaluation loop:** `start()/stop()` — periodic `setInterval` that scans all tracked projects via `stateService.getConfig()`. Uses `Promise.allSettled` for graceful per-project failures. Preserves dismissed state across evaluations. Broadcasts new items via WebSocket.
- **REST endpoints:** `GET /api/attention` (filterable list), `GET /api/attention/count` (unread count + by-severity breakdown), `POST /api/attention/:id/dismiss` (mark read, returns updated count).
- **WebSocket:** Added `"attention"` to `Channel` union in `ws/types.ts`. Plugin broadcasts `{ type: "attention:new", items, unreadCount }` to attention channel subscribers.
- **Entry point:** `src/server/index.ts` — boots Fastify, registers plugins (CORS, static), routes, and handles graceful shutdown.
- **Config:** `src/server/config.ts` — centralized `loadConfig()` reads PORT, HOST, NODE_ENV, CORS_ORIGIN from env. Default port 3000.
- **Route pattern:** Fastify plugin pattern. Routes live in `src/server/routes/`. Each file exports a `FastifyPluginAsync` registered via `server.register()`.
- **Health route:** `src/server/routes/health.ts` → `GET /api/health` returns `{ status: "ok", uptime }`.
- **Static serving:** `@fastify/static` serves `dist/client/` in production only. SPA fallback via `setNotFoundHandler` → `index.html`.
- **CORS:** `@fastify/cors` enabled in dev mode only, origin defaults to `http://localhost:5173` (Vite dev server).
- **Shutdown:** SIGINT + SIGTERM handlers call `server.close()` for clean exit.
- **Build:** `tsconfig.server.json` excludes `__tests__/` and `*.test.ts` from production build. Tests run via vitest separately.
- **Shebang:** `#!/usr/bin/env node` in index.ts survives tsc compilation → enables `npx github:arjendev/launchpad-hq` via bin entry.

### 2026-03-13: REST API for projects and issues (#7)
- **Routes file:** `src/server/routes/github-data.ts` — 4 REST endpoints for GitHub data consumption.
- **Endpoints:**
  - `GET /api/projects/:owner/:repo/issues` — Lists issues with `state`, `label`, `assignee` query filters. Label/assignee are client-side filtered (GraphQL doesn't support them natively). Pagination via `first`/`after`.
  - `GET /api/projects/:owner/:repo/pulls` — Lists PRs with `state` filter (OPEN/CLOSED/MERGED). Pagination via `first`/`after`.
  - `GET /api/projects/:owner/:repo/overview` — Aggregated project view: metadata, issue/PR counts by state, recent issues/PRs. Uses `Promise.all` for 6 parallel GraphQL queries.
  - `GET /api/dashboard` — Cross-project dashboard: total issues, PRs, per-project counts. Uses `Promise.allSettled` for graceful partial failures.
- **Guards:** All project-scoped routes verify the project is tracked via `stateService.getConfig()`. Returns 404 if not tracked.
- **Error mapping:** `GitHubGraphQLError` codes map to HTTP: NOT_FOUND→404, UNAUTHORIZED→401, RATE_LIMITED→429, others→502.
- **GraphQL plugin:** Registered `githubGraphQLPlugin` in `index.ts` (was missing — TARS created the plugin but it wasn't wired up).
- **Tests:** 19 unit tests in `src/server/__tests__/github-data.test.ts` covering all routes, filters, pagination, error codes, and partial dashboard failures.
- **Pattern:** Same `FastifyPluginAsync` pattern as `projects.ts`. Mock GraphQL client + stateService via Fastify decorators in tests.

### 2026-03-13: WebSocket server infrastructure (#13)
- **Plugin:** `src/server/ws/plugin.ts` — Fastify plugin using `ws` with `noServer: true`. Handles HTTP upgrade on `/ws` path. Registered before routes in `index.ts`.
- **Types:** `src/server/ws/types.ts` — Full TypeScript types for all message shapes. `ClientMessage` union (subscribe/unsubscribe/ping), `ServerMessage` union (update/pong/error). `Channel` type: "devcontainer" | "copilot" | "terminal".
- **ConnectionManager:** `src/server/ws/connections.ts` — Tracks clients by UUID. Manages channel subscriptions, per-client send, channel broadcast. Exposes `all()` iterator for heartbeat sweeps.
- **Handler:** `src/server/ws/handler.ts` — Parses incoming JSON, validates `type` field, routes to subscribe/unsubscribe/ping handlers. Returns typed errors for invalid JSON, unknown channels, unknown message types.
- **Heartbeat:** 30s interval ping/pong. Marks client `alive=false`, sends ping frame, terminates on next interval if no pong received.
- **Decorator:** `server.ws.broadcast(channel, payload)` and `server.ws.clients()` available to all other plugins/routes for pushing live updates.
- **Cleanup:** `onClose` hook clears heartbeat interval, terminates all sockets, closes `WebSocketServer`.
- **Vite proxy:** Already configured in `vite.config.ts` — `/ws` → `ws://localhost:3000` with `ws: true`. Works out of the box.
- **Tests:** 14 unit tests in `src/server/__tests__/ws.test.ts` covering ConnectionManager (add/remove/subscribe/broadcast/send) and message handler (ping→pong, subscribe, unsubscribe, invalid JSON, missing type, unknown channel, unknown type).

### 2026-03-13: Project CRUD API (#12)
- **Routes:** `src/server/routes/projects.ts` — Fastify plugin with 5 endpoints:
  - `GET /api/projects` — list all tracked projects (reads from stateService)
  - `POST /api/projects` — add a project `{ owner, repo }`. Validates repo exists on GitHub, detects duplicates (case-insensitive), persists via stateService.
  - `DELETE /api/projects/:owner/:repo` — remove a project, cleans up enrichment data.
  - `PUT /api/projects/:owner/:repo` — update project enrichment (devcontainerStatus, sessionLinks). Requires project to be tracked first.
  - `GET /api/discover/repos` — paginated list of authenticated user's repos with `tracked` boolean flag.
- **State plugin registered:** `src/server/index.ts` now imports and registers `statePlugin` (from #10) before routes. Dependency chain: `github-auth` → `state` → routes.
- **Validation:** Owner/repo names validated against `[a-zA-Z0-9_.-]+` regex. Proper error objects with `error` code and `message` fields.
- **Tests:** 16 unit tests in `src/server/__tests__/projects.test.ts`. Mock pattern: decorate test server with mock `stateService`, `githubToken`, `githubUser` — no need for auth plugin in tests. `vi.stubGlobal("fetch")` for GitHub API calls.

## Phase 1 Summary

**Completed Issues:** #7, #12, #13 (3/8 Phase 1 items)  
**Total Tests Added:** 19 + 16 + 14 = 49 tests  
**Commits:** 3 (REST API, project CRUD, WebSocket server)  

Romilly delivered the complete backend API surface for launchpad:
1. **REST API endpoints** — github-data.ts routes for issues, PRs, overview, dashboard with GraphQL integration
2. **Project CRUD API** — full lifecycle management with GitHub validation, discovery endpoint, enrichment cleanup
3. **WebSocket server** — channel-based messaging with connection tracking, heartbeat monitoring, broadcast capability

All three modules are integrated into the server with correct plugin registration order. The state plugin (TARS #10) was wired into index.ts, unblocking project routes. GitHub GraphQL plugin (TARS #6) was wired into index.ts, enabling data endpoints.

Romilly's work is the bridge between TARS' data access layer and Brand's frontend. All issues closed on GitHub.

### 2026-03-13: Attention system — data model & server logic (#18)
- **Module:** `src/server/attention/` — types, rules engine, manager, Fastify plugin, barrel export.
- **Types:** `AttentionItem` (id, type, severity, project, message, timestamp, url, sourceId, dismissed). `AttentionType`: issue_stale, pr_needs_review, ci_failing, session_idle. `AttentionSeverity`: info, warning, critical.
- **Rule engine:** `rules.ts` — pure functions: `evaluateStaleIssues` (configurable staleDays, escalates to critical at 2× threshold), `evaluatePrNeedsReview` (open non-draft PRs), `evaluateCiFailing` (stub — needs checks API), `evaluateSessionIdle` (stub — needs Copilot SDK #15). `evaluateRules()` orchestrates all enabled rules. `evaluateProjectAttention()` fetches data via GraphQL then evaluates.
- **Manager:** `AttentionManager` class — in-memory Map store, configurable maxItems with LRU eviction (dismissed first). `list()` with filtering (severity, project, type, dismissed) and sorting (severity → date). `dismiss()`, `unreadCount()`, `unreadCountBySeverity()`.
- **Evaluation loop:** `start()/stop()` — periodic `setInterval` that scans all tracked projects via `stateService.getConfig()`. Uses `Promise.allSettled` for graceful per-project failures. Preserves dismissed state across evaluations. Broadcasts new items via WebSocket.
- **REST endpoints:** `GET /api/attention` (filterable list), `GET /api/attention/count` (unread count + by-severity breakdown), `POST /api/attention/:id/dismiss` (mark read, returns updated count).
- **WebSocket:** Added `"attention"` to `Channel` union in `ws/types.ts`. Plugin broadcasts `{ type: "attention:new", items, unreadCount }` to attention channel subscribers.
- **Plugin registration:** `attentionPlugin` registered in `index.ts` after state/graphql plugins. Uses `onReady` hook for lazy dependency wiring.
- **Tests:** 35 tests in `src/server/__tests__/attention.test.ts` — rule evaluators (stale/fresh/closed issues, draft/open PRs, stubs), rule engine (enabled/disabled), deterministic IDs, manager (CRUD, filtering, sorting, dismissal, counts, maxItems, clear), REST endpoints (list, filter, count, dismiss, 404).
- **Note:** Parallel filesystem entanglement struck again — attention files were captured in the copilot #15 commit. Had to commit the index.ts registration separately. See decisions.md entry on this pattern.

### 2026-03-13: Server watch mode & VS Code integration
- Added `tsx --inspect-brk` launch profile "Server (Debug)" with sourceMap support
- "Full Stack" compound profile now starts server + client correctly via preLaunchTask
- Server reloads on file changes; breakpoints work during development
- Improves dev loop compared to manual restarts

### 2026-03-13: Wired cache plugin into server bootstrap
- Cache module existed and tested but was never registered in `src/server/index.ts`
- Added `import apiCachePlugin from "./cache/plugin.js"` and `await server.register(apiCachePlugin)` before routes
- Dependency chain now: `github-auth` → `state` → `api-cache` → routes
- Cache endpoints `/api/cache/stats` and cache invalidation now live on the server

## Phase 2 Summary

**Completed Issues:** #18 (1/5 Phase 2 items)
**Total Tests Added (Phase 2):** 35 tests
**Commits:** 2 (attention system, cache plugin wiring)

Romilly delivered the attention system — a rule-based alerting layer that identifies high-priority issues, stale PRs, and other actionable items. The system is fully testable, configurable, and broadcasts updates via WebSocket in real-time.

Key learnings:
- Rule engine uses pure functions — testable without mocking
- Manager uses in-memory LRU storage with SHA-256 deterministic IDs for stable deduplication across evaluation cycles
- Dismissal state persists across re-evaluations
- Graceful per-project failure via Promise.allSettled

Also fixed a Medium-priority bug: the cache plugin wasn't registered. Found during integration testing and fixed immediately.

Decision on attention system architecture captured in decisions.md.


## Phase 2 Summary

**Completed Issues:** #18 (1/5 Phase 2 items)
**Total Tests Added (Phase 2):** 35 tests
**Commits:** 2 (attention system, cache plugin wiring)

Romilly delivered the attention system — a rule-based alerting layer that identifies high-priority issues, stale PRs, and other actionable items. The system is fully testable, configurable, and broadcasts updates via WebSocket in real-time.

Key learnings:
- Rule engine uses pure functions — testable without mocking
- Manager uses in-memory LRU storage with SHA-256 deterministic IDs for stable deduplication across evaluation cycles
- Dismissal state persists across re-evaluations
- Graceful per-project failure via Promise.allSettled

Also fixed a Medium-priority bug: the cache plugin wasn't registered. Found during integration testing and fixed immediately.

Decision on attention system architecture captured in decisions.md.


### 2026-03-13: HQ daemon registry (#34)
- **Module:** `src/server/daemon-registry/` — registry, WS handler, Fastify plugin, barrel export.
- **Registry:** `DaemonRegistry` extends EventEmitter. In-memory Map of `TrackedDaemon` (daemonId → ws + info + state + heartbeat). Methods: `register`, `unregister`, `getDaemon`, `getAllDaemons`, `sendToDaemon`, `broadcastToDaemons`, `recordHeartbeat`, `checkHeartbeats`. Emits `daemon:connected` and `daemon:disconnected`.
- **Handler:** `DaemonWsHandler` manages auth handshake per connection. Flow: connect → auth-challenge (with nonce) → auth-response (token + nonce) → validate via `validateDaemonToken` from shared → auth-accept/reject → register → message routing. Pending connections tracked in Map<WebSocket, PendingConnection>.
- **Message routing:** After auth, routes daemon messages by type: `register` → registry, `heartbeat` → recordHeartbeat, `status-update` → broadcast to "daemon" channel, `terminal-data` → broadcast to "terminal" channel, `copilot-session-update`/`copilot-conversation` → broadcast to "copilot" channel, `attention-item` → broadcast to "attention" channel.
- **Plugin:** `daemonRegistryPlugin` wraps as Fastify plugin with `dependencies: ["websocket"]`. Creates separate `WebSocketServer({ noServer: true })` for `/ws/daemon` path. Decorates `server.daemonRegistry`. Registers lifecycle events for browser broadcast. Starts heartbeat monitor. Cleans up on close.
- **REST:** `src/server/routes/daemons.ts` — `GET /api/daemons` (list), `GET /api/daemons/:id` (detail), `POST /api/daemons/:id/command` (send command with action + args). Error codes: 400 bad_request, 404 not_found, 502 send_failed.
- **WS channels:** Added `"daemon"` and `"attention"` to `Channel` type and `VALID_CHANNELS` set in `ws/types.ts`.
- **Critical fix:** Removed `socket.destroy()` from browser WS plugin for non-`/ws` upgrade paths — was killing daemon connections before they reached the daemon handler.
- **Token lookup:** Currently returns `undefined` (TODO: wire to stateService once project tokens are persisted). Tests use a mock lookup.
- **Tests:** 33 tests covering registry CRUD, EventEmitter events, sendTo/broadcast, heartbeat timeout, auth challenge/response (correct/wrong nonce/token), message routing (all types), disconnect handling, REST endpoints (200/400/404/502).
- **Imports:** All protocol types from `src/shared/protocol.ts`, `validateDaemonToken` from `src/shared/auth.ts`, constants from `src/shared/constants.ts`. Zero local type duplication.

## Wave 1 Summary

**Phase 1 + Phase 2 Complete:** All Wave 1 issues closed (#25, #30, #34, #36)
**Total Tests Added (Wave 1):** TARS 131 tests, Brand 280 unit + 5 e2e, Romilly 117 tests = 533 total
**Total Tests Passing:** 351 (integrated)

Wave 1 delivered foundational daemon architecture, frontend UI, and backend data integration. All Phase 1 issues (#25, #30, #34, #36) closed on GitHub. Decisions finalized for hub-and-spoke model, shared protocol types, dual-WebSocket pattern, theme system, and Copilot SDK integration approach.



### 2025-07-24: Session end cleanup bug fix
- **Bug:** Clicking "End" on a Copilot session did not remove it from the UI.
- **Root cause:** Three bugs across the stack — aggregator had no `removeSession()`, abort route didn't clean up aggregator, daemon manager didn't clean up `activeSessions` or emit `session.ended`.
- **Fix 1 (Aggregator):** Added `removeSession(sessionId)` — deletes from `sessions`, `conversationHistory`, `toolInvocations` maps, emits `sessions-updated`. `handleSessionEvent` now handles `session.ended` by calling `removeSession`; no stub created for ended sessions.
- **Fix 2 (Abort route):** Changed from failing with 502 on disconnected daemon to always succeeding — sends abort best-effort, then always calls `removeSession` so UI updates immediately.
- **Fix 3 (Daemon manager):** `handleAbort` now unsubscribes event handler, removes from `activeSessions`, and emits `session.ended` back to HQ.
- **Protocol:** Added `session.ended` to `CopilotSessionEventType` union in `src/shared/protocol.ts`.
- **Tests:** Added 8 new tests (removeSession, session.ended handling, abort-with-cleanup, disconnected-daemon-abort). Updated 3 existing tests for new behavior. All 645 tests pass.
- **Key learning:** Abort cleanup needs to be idempotent — HQ removes immediately on user action, daemon emits `session.ended` as a safety net. Both paths converge on `removeSession` which is a no-op for already-removed sessions.
- **Commit:** c15a8fc
- **Decision captured in:** `.squad/decisions/decisions.md` — "Backend — Session abort cleanup strategy"

### Session API Redesign

**Scope:** Protocol types, aggregator, daemon handler, aggregator plugin, REST routes, client types.

**Changes:**
1. **Protocol (`src/shared/protocol.ts`):** Removed `daemonId`/`projectId` from `AggregatedSession`. Added 8 HqToDaemon messages (set-model, get/set-mode, get/update/delete-plan, disconnect-session, list-models) and 2 DaemonToHq responses (mode-response, plan-response). Added `requestId` to `CopilotModelsListMessage`.
2. **Aggregator (`src/server/copilot-aggregator/aggregator.ts`):** Created `InternalAggregatedSession` extending `AggregatedSession` with `daemonId`/`projectId`. Added `toClientSession()` helper. `getSession()`/`getAllSessions()` return client-stripped types. `getInternalSession()` for server-side routing. Added `waitForResponse()`/`resolveRequest()` for request-response pattern with timeout.
3. **Handler (`src/server/daemon-registry/handler.ts`):** Routes `copilot-models-list`, `copilot-mode-response`, `copilot-plan-response` to registry events.
4. **Plugin (`src/server/copilot-aggregator/plugin.ts`):** Wires new registry events to `aggregator.resolveRequest()` for pending REST requests.
5. **Routes (`src/server/routes/copilot-sessions.ts`):** Added `sendToDaemon()` helper. New routes: resume, set-model, get/set mode, get/post/delete plan, disconnect, list-models. Existing routes updated to use `getInternalSession()` for routing. Request-response routes (GET mode, GET plan, GET models) await daemon reply with 10s timeout.
6. **Client:** Updated `AggregatedSession` in `services/types.ts` (removed `daemonId`/`projectId`, added `title`/`mode`). Removed `daemonId` prop from `CopilotConversation`. Simplified `ConnectedProjectPanel` callback signatures.

**Tests:** 669 passing (17 new). Existing tests updated to use `getInternalSession()` for internal field assertions and verify client responses are stripped.

**Pattern:** Request-response for GET routes uses `waitForResponse(requestId)` → daemon responds → `resolveRequest(requestId, data)`. Fire-and-forget for POST/DELETE operations returns `{ ok: true }` immediately.

## Learnings

### Inbox System Backend (Session 7)

**Built:** Full inbox system backend — types, persistence, routes, tool-invocation wiring.

**Files changed:**
- `src/server/state/types.ts` — Added `InboxMessage`, `ProjectInbox`, `defaultProjectInbox()`, extended `StateService` with `getInbox()`/`saveInbox()`
- `src/server/state/state-manager.ts` — Implemented `getInbox()`/`saveInbox()` using existing `readState()`/`writeState()` private helpers. Inbox files stored at `inbox/{owner}/{repo}.json` in launchpad-state repo.
- `src/client/services/types.ts` — Added `InboxMessage`, `InboxListResponse`, `InboxCountResponse` for client consumption.
- `src/server/ws/types.ts` — Added `"inbox"` channel to `Channel` union and `VALID_CHANNELS` set.
- `src/server/routes/inbox.ts` — New Fastify route plugin: `GET /api/projects/:owner/:repo/inbox` (list+filter), `GET .../inbox/count` (badge), `PATCH .../inbox/:id` (status update). Broadcasts on "inbox" channel after PATCH.
- `src/server/index.ts` — Registered `inboxRoutes` plugin.
- `src/server/copilot-aggregator/plugin.ts` — Extended the `tool-invocation` event handler: when `request_human_review` or `report_blocker` fires, creates `InboxMessage` via `crypto.randomUUID()`, persists via `stateService.getInbox()/saveInbox()`, broadcasts `inbox:new-message` on the "inbox" WS channel. Fire-and-forget with error logging.

**Pattern:** Inbox paths are per-project (`inbox/{owner}/{repo}.json`), unlike config/preferences/enrichment which are global single files. The `readState()`/`writeState()` helpers work fine for arbitrary paths — no new generic plumbing needed.

**Key decisions:**
- Title derivation: `args.title ?? args.message ?? args.reason ?? tool name` — covers all tool arg shapes.
- Fire-and-forget persistence in the tool-invocation handler — no `await` so it doesn't block the event loop; errors logged.
- Separate "inbox" WS channel (not reusing "attention") to allow targeted subscriptions.

## Session: UI Redesign — Progressive Depth Navigation (2026-03-14)

**Delivered:** Inbox backend fully implemented. Tool invocations (request_human_review, report_blocker) now create inbox messages. Per-project persistence. Fire-and-forget pattern unblocks frontend.

**Key work:** Romilly-7 built complete inbox backend — types, StateManager persistence (per-project files in launchpad-state), tool-invocation wiring to create messages + WS broadcast, 3 REST routes + count endpoint. Title fallback chain handles both tool types. Separate "inbox" WS channel for targeted UI subscriptions.

- **Triple event root cause (3× different timestamps):** Three sources of duplicate events in `CopilotManager`:
  1. `client.on()` catch-all listener in `start()` duplicated per-session events already covered by `session.on()` in `trackSession()`, each generating different timestamps.
  2. `start()` had no idempotency guard — daemon reconnects (HQ restart) called it again, leaking another `client.on()` listener. One reconnect = 3× events.
  3. `handleCreateSession`/`handleResumeSession` sent explicit synthetic `session.start` events duplicating what `session.on()` already forwarded.
  Fix: (a) `start()` returns immediately if `this.started` is true. (b) `client.on()` handler skips events for sessions already tracked in `activeSessions`. (c) `trackSession(session, skipInitialStart)` suppresses the first `session.start` from `session.on()` when create/resume already sent one explicitly. (d) `trackSession` now cleans up old unsubscriber before attaching new listener.

### Issue #23: Dev Tunnels — Fastify routes + --tunnel CLI flag
- **Tunnel route plugin:** `src/server/routes/tunnel.ts` — uses `fp` (fastify-plugin) to expose `tunnelManager` as a Fastify decorator. Depends on `websocket` plugin. Routes: GET /api/tunnel (status, never throws), POST /api/tunnel/start (with port resolution from body or server address), POST /api/tunnel/stop, GET /api/tunnel/qr (base64 QR code via `qrcode` npm package).
- **WS broadcast:** TunnelManager emits `status-change` events → plugin broadcasts `{ type: "tunnel:status", ...state }` on the new `"tunnel"` channel. Added `"tunnel"` to `Channel` union and `VALID_CHANNELS` set in `ws/types.ts`.
- **--tunnel CLI flag:** Parsed in `loadConfig()` via `process.argv.includes("--tunnel")`. Added `tunnel: boolean` to `ServerConfig`. In `index.ts` `start()`, auto-calls `tunnelManager.start(config.port)` after server listen, with console output for tunnel URL and share URL. Non-fatal — logs warning if tunnel fails.
- **Parallel build with TARS:** Route plugin imports `TunnelManager` from `../tunnel.js` which TARS is building concurrently. Interface contract: `TunnelManager extends EventEmitter` with `start(port)`, `stop()`, `getStatus()`, `getState()`, `getShareUrl()`, `generateToken()`, `isCliAvailable()`. Emits `status-change` event.
- **Package additions:** `qrcode` (runtime) + `@types/qrcode` (devDep) installed for QR code generation.

### Cross-Team Summary (2026-03-14 orchestration)
- TARS completed TunnelManager with EventEmitter status, CLI token generation, and singleton factory
- Brand integrated TunnelButton/Modal UI with REST polling hooks and QR code display
- Coordinator fixed TS2783 duplicate error property in tunnel routes
- All work committed; tunnel feature ready for testing

### 2026-03-15: Onboarding Wizard Issues #39–#45
Cooper groomed onboarding wizard epic and created 7 GitHub issues assigned across the team. **You own issues #39–#40**:
- **#39 (P1)**: State management — local vs git persistence modes — Add `LocalStateManager` impl of `StateService` interface (filesystem-only, no GitHub). Current `StateManager` is hardwired to `GitHubStateClient`.
- **#40 (P0, shared with Brand)**: First-launch onboarding wizard core framework — Wire wizard into `src/cli.ts` before server import. Create `LaunchpadConfig` schema + parsing. Wizard runs in terminal, collects choices, writes config, server boots normally.

Dependencies: #40 is P0 blocker for wizard steps #41–#44 owned by Brand/TARS. #39 should complete in parallel or before #41. Full context: `.squad/decisions.md`. Architecture: new `LaunchpadConfig` persisted at `~/.launchpad/config.json` (distinct from ServerConfig/ProjectConfig), read at boot before plugins load. Implementation order: #45 (TARS crash fix) → (#39+#40 parallel) → (#41–#44 steps).

### 2026-03-15: LaunchpadConfig routed through state repo in git mode
- **Directive from Arjen:** "depending on settings everything locally or everything in repo." When stateMode is "git", ALL config including LaunchpadConfig must go to the state repo — not just ProjectConfig/UserPreferences/EnrichmentData.
- **Architecture:** Introduced `BootstrapConfig` type (version + stateMode + stateRepo) — the only thing that stays in `~/.launchpad/config.json` in git mode. Full `LaunchpadConfig` (copilot prefs, tunnel mode, model, onboarding status) stored as `launchpad-config.json` in the state repo.
- **StateService interface:** Added `getLaunchpadConfig()` and `saveLaunchpadConfig()` to the interface. Both `GitStateManager` and `LocalStateManager` implement them.
- **Plugin boot flow:** After syncing the state service, the plugin resolves the full config by merging bootstrap fields (stateMode, stateRepo from local) with the rest from the state repo. `fastify.launchpadConfig` is authoritative at runtime.
- **Settings routes:** GET reads from `fastify.launchpadConfig` (already resolved at boot). PUT writes to the appropriate backend: state repo + bootstrap locally in git mode, full file locally in local mode. Hot-swap on stateMode change migrates launchpad config too.
- **Migration:** When switching local→git, the full LaunchpadConfig is now included in the state snapshot that gets migrated to the git backend.
- **New helpers:** `loadBootstrapConfig()` and `saveBootstrapConfig()` in `launchpad-config.ts` for reading/writing the minimal local file.
- **Tests:** 908 passing. Added 8 new tests for bootstrap config round-tripping, launchpad-config.json in GitStateManager (read/write/sync), and GET settings endpoint.
- **Key insight:** Bootstrap fields must ALWAYS come from local — you can't bootstrap from git without knowing where git is. The merge strategy is: defaults ← remote ← bootstrap overrides.
- **Commit:** 9c1b8f6

### 2026-03-15: Issue #54 — Preview Proxy (Server Side, Option A)

**Scope:** Server-side preview proxy — path-based routing through the HQ DevTunnel.

**Proxy chain:** Phone → DevTunnel → HQ Fastify `/preview/:projectId/*` → daemon WS → localhost:previewPort → response back.

**Files changed (server domain):**
- `src/server/daemon-registry/registry.ts` — Added `previewPort`, `previewAutoDetected`, `previewDetectedFrom` to `TrackedDaemon` and `DaemonSummary`. Added `updatePreviewConfig()` and `findDaemonByProjectId()` methods.
- `src/server/daemon-registry/handler.ts` — Added cases for `preview-config` (stores config + broadcasts on "preview" channel), `preview-proxy-response` (emits on registry for request matching), `preview-ws-data` and `preview-ws-close` (Phase 3 WS relay).
- `src/server/routes/preview.ts` — New Fastify plugin. Wildcard `/preview/:projectId/*` proxy route with Map-based request/response matching (Promise + timeout). REST API: GET /api/preview (list), GET /api/preview/:projectId (detail), GET /api/preview/:projectId/qr (QR code via `qrcode` lib). Phase 3: start/stop control routes, WS relay helpers with channel tracking.
- `src/server/ws/types.ts` — Added `"preview"` to `Channel` union and `VALID_CHANNELS`.
- `src/server/index.ts` — Registered `previewRoutes` plugin after tunnel plugin.
- `src/server/__tests__/preview.test.ts` — 15 tests: registry preview fields (5), handler message routing (2), request/response matching + timeout (3), WS relay helpers (4), QR generation (1).

**Key patterns:**
- **Request/response matching:** `Map<string, { resolve, reject, timeout }>` keyed by requestId. `resolvePreviewResponse()` exported for handler.ts to call. 30s timeout → 504 Gateway Timeout.
- **Base64 body encoding:** Request body encoded as base64 for binary safety over WS. Response body decoded from base64 before forwarding.
- **Hop-by-hop header stripping:** Removes connection, keep-alive, transfer-encoding, etc. from both request and response headers.
- **URL-encoded projectId:** Supports `owner%2Frepo` in URL path via `decodeURIComponent()`.
- **Plugin dependencies:** `["websocket", "daemon-registry", "tunnel"]` — registered after tunnel plugin for QR URL generation.

**TARS parallel work:** Protocol types already in `src/shared/protocol.ts` — no inline type stubs needed. TARS's daemon-side preview handler/detect files were included in the combined commit.

**Tests:** 969 passing (15 new). Typecheck + build clean.
**Commit:** 4b5bdd1

### 2026-03-15: Wave 1 — Issue #54 (Preview Feature) Complete
- **Agent-37 (TARS)**: Protocol types, PreviewProxyHandler, port detection (22 tests) ✅ Merged to main
- **Agent-38 (Romilly)**: HQ preview routes, QR generation, tunnel info (15 tests) ✅ Merged to main
- **Agent-39 (Brand)**: Preview UI hooks, PreviewButton/Modal/Panel components (20 tests) ✅ Merged to main
- **Total tests**: 908 baseline → 969 final (+61: 22 + 15 + 20 + 4 coordination tests)
- **Build & typecheck**: Clean, no regressions
- **Decision**: Single HQ tunnel with path-based routing (Option A); Map-based request matching with 30s timeout; base64 encoding for binary safety over WebSocket

### 2026-03-15: Fix silent state fallback — git mode auth check

**Problem:** TARS's non-fatal auth change (commit 0c77d35) added a silent fallback in `src/server/state/plugin.ts`: when `stateMode: "git"` was configured but `githubToken` was null (due to auth failure), the state plugin quietly switched to `LocalStateManager`. This created a split-brain — user expected state in the git repo but changes went to local filesystem.

**Root cause:** The `buildStateService()` function checked `!githubToken || !githubUser` and returned `buildLocalStateService()` with only a `log.warn`. No error surfaced to the user or UI.

**Fix:** Replaced the silent fallback with a thrown error containing clear instructions: run `gh auth login` or set `stateMode: "local"`. Server refuses to start in git mode without valid auth — no split-brain possible.

**Files changed:** `src/server/state/plugin.ts` (throw instead of fallback), `src/server/state/__tests__/plugin.test.ts` (+2 tests for null token and null user cases). Also restored `~/.launchpad/config.json` to `stateMode: "git"`.

**Tests:** 977 passing (2 new). Typecheck + build clean.
**Commit:** cebeded

### 2026-03-16: Issue #68 Implementation Complete
Romilly implemented onboarding flow choice (#68) via environment variable signal pattern:
- CLI prompts user: "Complete setup in [1] Terminal or [2] Browser?"
- Terminal choice: interactive CLI wizard collects config
- Browser choice: sets `process.env.LAUNCHPAD_OPEN_ONBOARDING`, server opens browser to `/onboarding?token=<token>` after startup
- User choice persisted in LaunchpadConfig (`~/.launchpad/config.json`)
- Both flows produce identical final config

Test suite: 1022 tests passing. No regressions.

**Cross-team note:** Also implemented server-side auth hardening (token auth routes, CORS, @fastify/helmet, preview port blocklist, file permissions 0o700/0o600). Coordinated with Brand on client-side token persistence.

### 2026-03-20: Workflow State Machine, GitHub Sync, and API — Phase 1 (#72)
- **State machine** (`src/server/workflow/state-machine.ts`): 6 states (backlog, in-progress, needs-input-blocking, needs-input-async, ready-for-review, done) with validated transitions. Typed events (`WorkflowStateChangedEvent`, `WorkflowSyncCompletedEvent`). `InvalidTransitionError` for rejected transitions. Label mapping: `hq:backlog`, `hq:in-progress`, `hq:review`, `hq:done`.
- **GitHub sync** (`src/server/workflow/github-sync.ts`): Reads issues via `gh` CLI with `GH_TOKEN` env. Maps to `WorkflowIssue` objects. Syncs HQ labels to GitHub (removes stale hq: labels first). Posts comments only for blocking/async input requests and completion (not every transition). Uses existing `server.githubToken` decorator.
- **Workflow store** (`src/server/workflow/store.ts`): In-memory per-project state. Piggybacks on enrichment data layer for persistence (adds `workflowState` to enrichment entries). Periodic flush (30s interval) + flush on shutdown. No new state files needed.
- **REST API** (`src/server/routes/workflow.ts`): 4 endpoints as Fastify plugin — GET issues, POST sync, PUT state transition, POST feedback. State transitions fire background label sync + comment posting to GitHub. Invalid transitions return 422.
- **WebSocket**: Added `"workflow"` to Channel type. State machine events broadcast to subscribers on the `workflow` channel.
- **Tests:** 64 new tests across 4 files (30 state machine, 5 sync, 11 store, 14 API integration + 4 edge cases). Total: 1086 passing.
- **Pattern note:** Mocking `node:child_process` for `promisify(execFile)` requires attaching `[util.promisify.custom]` on the mock function — Node's built-in execFile has a custom promisify symbol that returns `{stdout, stderr}` instead of just the first callback arg.
- **Cross-team coordination:** Parallel with Brand's frontend implementation (WorkflowIssueList, 3 hooks, badges). API endpoints tested separately, integration via REST + WebSocket merge pattern.

### 2026-03-20: npm Metadata and Trusted Publishers Analysis
- Analyzed publishing strategy for launchpad-hq npm package. Package name claimed, metadata fields added (repository, homepage, bugs).
- Trusted Publishers (OIDC) recommended as sole auth mechanism — no NPM_TOKEN secret. Requires Node 24+ in CI (npm CLI ≥11.5.1), but `engines` field remains ≥18 for end users.
- First publish is manual (Arjen): `npm publish --access public`. Then configure trusted publisher on npmjs.com.
- Provenance attestations automatic from trusted publishers; no `--provenance` flag needed.
- Windows tarball workaround remains as fallback but no longer primary recommendation.

### 2026-03-20: Phase 2 Autonomous Dispatch — HQ Server Side (#72)
- **CoordinatorState module** (`src/server/workflow/coordinator-state.ts`): Pure functions for coordinator lifecycle (starting→active→crashed→stopped) and dispatch tracking (add, update status, get active). Immutable state pattern — each function takes current state, returns new state. Designed for easy persistence and testing.
- **CommitTracker** (`src/server/workflow/commit-tracker.ts`): Regex-based issue reference parser (`#N`, `fixes #N`, `closes #N`, `resolves #N`). In-memory dual index: project→commits and project+issue→SHA set. Deduplicates by SHA. Serializable for persistence.
- **WorkflowStore extended**: Added `coordinator: CoordinatorProjectState` and `commits: TrackedCommit[]` to project state. CommitTracker instance lives on store. Load/flush/close all round-trip coordinator + commit data through the existing enrichment persistence layer.
- **6 new API endpoints**: coordinator start/stop/status, issue dispatch (validates backlog state + active coordinator), commits-by-issue. Dispatch sends `workflow:dispatch-issue` to daemon via registry.
- **Daemon event listeners**: Wired 5 daemon→HQ events on the daemonRegistry EventEmitter (coordinator-started, crashed, health, progress, issue-completed). Progress events track commits. Issue-completed transitions to ready-for-review and marks dispatch completed.
- **Client WS broadcasts**: 4 event types on "workflow" channel (coordinator-status-changed, dispatch-started, progress, issue-completed).
- **62 new tests** (17 coordinator-state + 22 commit-tracker + 23 dispatch-api including integration flow test).
- **Key design choice**: Tests interact through HTTP inject + EventEmitter events, never reaching into encapsulated Fastify plugin state directly. The `activateCoordinator()` helper simulates daemon messages via registry event emission.
- **Coordination with TARS**: TARS already committed protocol types and daemon handler forwarding in prior commit (3f51936). My work extends the server-side persistence, API endpoints, and commit tracking on top of that.

### 2026-03-20: Rejected State + Issue CRUD APIs
- **`rejected` terminal state**: Added to `WorkflowState` union, `ALL_WORKFLOW_STATES`, transition table (reachable from all active states, terminal like `done`). Label mapping: `hq:rejected`. Closes issue on GitHub with `--reason "not planned"`.
- **`done` from any active state**: Previously only reachable from `ready-for-review`. Now `backlog`, `in-progress`, `needs-input-blocking`, `needs-input-async` can all transition directly to `done`.
- **Issue close on terminal transitions**: Both `done` and `rejected` now call `syncService.closeIssue()` with appropriate reason (`completed` vs `not_planned`).
- **POST /api/workflow/:owner/:repo/issues**: Creates issue via `gh issue create`, auto-adds `hq:backlog` label, triggers sync, returns the new `WorkflowIssue`.
- **GET /api/workflow/:owner/:repo/issues/:number/comments**: Fetches comments via `gh issue view --json comments`, returns `{ comments: [{ author, body, createdAt }] }`.
- **PUT /api/workflow/:owner/:repo/issues/:number**: Edits title/body via `gh issue edit`, re-syncs, returns updated `WorkflowIssue`.
- **GitHubSyncService extended**: New methods `closeIssue()`, `createIssue()`, `getIssueComments()`, `editIssue()`. Added `rejected` to `COMMENT_STATES` with 🚫 emoji comment.
- **Tests updated**: State machine tests cover all new valid/invalid transitions, terminal rejected state, done-from-anywhere. API tests cover rejected transition, done-from-backlog, error message includes `rejected`, comments endpoint. All mocks updated across 4 test files.

### 2026-03-21: Phase 1 Architecture Refactor — Typed Event Bus + Workflow Plugin Extraction (#76)
- **DaemonEventBus** (`src/server/daemon-registry/event-bus.ts`): Typed EventEmitter using declaration merging pattern. `DaemonEventMap` interface defines all 23 daemon→HQ event types with full argument tuples. `DaemonRegistry` now extends `DaemonEventBus` instead of raw `EventEmitter`, eliminating all `as never` casts (20 in handler.ts, 10 in copilot-aggregator, etc.).
- **Workflow plugin** (`src/server/workflow/plugin.ts`): Extracted service instantiation (WorkflowStore, StateMachine, ElicitationStore, ActivityStore), Fastify decoration, and event wiring from routes/workflow.ts into a standalone `fp()`-wrapped plugin. Registered before routes in server index.
- **Daemon events handler** (`src/server/workflow/daemon-events.ts`): Extracted all 7 daemon event listeners + auto-start coordinator logic + ALL workflow browser broadcasts from both handler.ts and routes/workflow.ts. Single ownership of workflow broadcasts eliminates prior duplication.
- **handler.ts cleanup**: Removed all `as never` casts (20 occurrences) and all 7 workflow `this.broadcast("workflow", ...)` calls. Handler now only emits to the typed event bus; browser broadcasts are owned by daemon-events.ts.
- **routes/workflow.ts slimmed**: 1,183 → 889 lines. All service creation, decoration, event wiring, and daemon listeners removed. File now contains only the 22 route handler definitions.

#### Learnings
- **Fastify encapsulation quirk (CRITICAL)**: Object destructuring of Fastify decorators in non-fp() plugins (`const { workflowStore: store } = server`) captures the value at registration time. When an fp()-wrapped plugin (different encapsulation context) updates the decorator, the captured reference is stale. Fix: use explicit property access (`const store = server.workflowStore`). This caused 20 test failures and was the hardest bug to find.
- **fp() dependency declarations vs test reality**: Declaring `dependencies: ["websocket"]` in fp() options causes failures in tests that decorate `server.ws` directly without registering a named "websocket" plugin. Only declare dependencies on plugins that are formally registered in ALL environments (prod + test).
- **Declaration merging for typed EventEmitter**: Define an interface and class with the same name. The interface provides typed `on`/`emit` overloads; the class extends EventEmitter for runtime behavior. Requires `// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging`.
- **Broadcast ownership principle**: When extracting event handlers from a monolith, browser broadcasts should move with the event listener (to daemon-events.ts), NOT stay in the message router (handler.ts). This prevents duplicate broadcasts and makes the broadcast logic testable alongside the business logic it serves.

### Phase 4: Deprecated Module Removal & Code Consolidation

**Scope:** Remove deprecated attention/ and inbox modules, encapsulate terminal state, centralize GitHub REST calls, deduplicate shared helpers.

**Files deleted:** `src/server/attention/` (5 files), `src/server/routes/inbox.ts`, `src/server/__tests__/attention.test.ts`, `src/client/components/InboxPanel.tsx`, `src/client/services/inbox-hooks.ts`

**Files created:**
- `src/server/github/rest.ts` — Centralized GitHub REST API helpers (checkRepo, searchRepos, listUserRepos, searchUsers). Used by routes/projects.ts and routes/settings.ts.
- `src/server/utils/validation.ts` — Shared validation helpers (isValidOwnerRepo, OWNER_REPO_REGEX, deriveDaemonInfo, deriveDaemonStatus). Used by routes/projects.ts and routes/github-data.ts.

**Key changes:**
- Removed "attention" and "inbox" from WS Channel types (server + client), VALID_CHANNELS sets, shared protocol union types
- Removed getInbox/saveInbox from StateService interface and both implementations (LocalStateManager, GitStateManager)
- Cleaned copilot-aggregator plugin: removed attention broadcast logic, inbox message creation on tool-invocation
- Removed attention-item case from daemon-registry handler
- Cleaned all test mocks (9 test files) of stale getInbox/saveInbox stubs
- TerminalTracker class encapsulates terminal module-level state as Fastify decorator (server.terminalTracker)

**Stats:** 50 files changed, -4437/+2649 lines. Typecheck: 0 errors. Tests: 64 files, 1124 tests pass.

#### Learnings
- **Removal scope is fractal:** Removing a module (attention/inbox) touches protocol types, WS channel types, daemon handler, aggregator plugin, state service interface, state implementations, route registrations, client hooks, client types, client components, and 9+ test mock objects. Always grep comprehensively after removals.
- **Test mock cleanup matters:** Even when StateService interface no longer has getInbox/saveInbox, test mocks with those methods still compile (TypeScript allows extra properties on object literals in some contexts). Clean them to avoid confusion.
- **Centralization payoff:** Moving 4 inline GitHub fetch calls to github/rest.ts and 5 duplicated helpers to utils/validation.ts reduced routes/projects.ts by ~100 lines and eliminated copy-paste drift risk between routes/projects.ts and routes/github-data.ts.
