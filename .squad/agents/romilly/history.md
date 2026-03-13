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

