# Project Context

- **Owner:** Arjen
- **Project:** launchpad — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Potentially leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, npx CLI, Terminal/Web UI, GitHub API, Copilot SDK, Devcontainer API
- **Created:** 2026-03-13

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-13: Fastify server skeleton (#2)
- **Entry point:** `src/server/index.ts` — boots Fastify, registers plugins (CORS, static), routes, and handles graceful shutdown.
- **Config:** `src/server/config.ts` — centralized `loadConfig()` reads PORT, HOST, NODE_ENV, CORS_ORIGIN from env. Default port 3000.
- **Route pattern:** Fastify plugin pattern. Routes live in `src/server/routes/`. Each file exports a `FastifyPluginAsync` registered via `server.register()`.
- **Health route:** `src/server/routes/health.ts` → `GET /api/health` returns `{ status: "ok", uptime }`.
- **Static serving:** `@fastify/static` serves `dist/client/` in production only. SPA fallback via `setNotFoundHandler` → `index.html`.
- **CORS:** `@fastify/cors` enabled in dev mode only, origin defaults to `http://localhost:5173` (Vite dev server).
- **Shutdown:** SIGINT + SIGTERM handlers call `server.close()` for clean exit.
- **Build:** `tsconfig.server.json` excludes `__tests__/` and `*.test.ts` from production build. Tests run via vitest separately.
- **Shebang:** `#!/usr/bin/env node` in index.ts survives tsc compilation → enables `npx launchpad-hq` via bin entry.

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



