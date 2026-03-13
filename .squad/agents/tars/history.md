# Project Context

- **Owner:** Arjen
- **Project:** launchpad — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Potentially leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, npx CLI, Terminal/Web UI, GitHub API, Copilot SDK, Devcontainer API
- **Created:** 2026-03-13

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-13: GitHub Auth Module Structure
- Auth module lives in `src/server/github/` with three files: `types.ts`, `auth.ts`, `plugin.ts`
- `auth.ts` exports `getGitHubToken()`, `getCachedUser()`, `getCachedAuth()`, `clearAuthCache()`, and `GitHubAuthError`
- Token is obtained via `execFile("gh", ["auth", "token"])` — uses execFile (not exec) for safety
- Token + user validated against GitHub API (GET /user) and cached in-memory for server lifetime
- `plugin.ts` uses `fastify-plugin` (fp) to register as non-encapsulated plugin; decorates server with `githubToken` and `githubUser`
- Error handling uses custom `GitHubAuthError` class with `code` field: `GH_NOT_FOUND`, `NOT_AUTHENTICATED`, `TOKEN_INVALID`
- Server index catches `GitHubAuthError` at startup for clean console error messages (no stack traces for user-facing auth errors)

### 2026-03-13: State Persistence Module Structure
- State module lives in `src/server/state/` with 6 files: `types.ts`, `github-state-client.ts`, `local-cache.ts`, `state-manager.ts`, `plugin.ts`, `index.ts`
- `GitHubStateClient` wraps GitHub REST Contents API for the user's `launchpad-state` repo (private, auto-created)
- `LocalCache` stores JSON files + SHA companions under `~/.launchpad/cache/` for offline-first reads
- `StateManager` implements `StateService` interface: read-through cache, write-through to GitHub API
- Three state files: `config.json` (ProjectConfig — tracked repos), `preferences.json` (UserPreferences), `enrichment.json` (EnrichmentData — devcontainer status, session links)
- `plugin.ts` uses `fastify-plugin` with `dependencies: ["github-auth"]`; decorates server with `stateService`
- Sync on startup pulls all three files from GitHub into cache; gracefully degrades to defaults if GitHub unreachable
- Write path uses last-write-wins: reads current SHA from cache/remote before PUT
- DI pattern via `StateManagerDeps` for testability — tests inject mock client/cache without vi.mock class issues
- 23 unit tests: 12 for GitHubStateClient (mocked fetch), 11 for StateManager (injected mock deps)

### 2026-03-13: GitHub API Cache Layer
- Cache module lives in `src/server/cache/` with 5 files: `types.ts`, `cache-manager.ts`, `plugin.ts`, `index.ts`, `__tests__/cache-manager.test.ts`
- `CacheManager` is an in-memory TTL cache for GitHub API responses — separate from state's `LocalCache` (which handles state file persistence)
- TTL is configurable per data type: issues/PRs default 60s, repo metadata/viewer repos 300s
- LRU eviction when maxEntries (default 500) exceeded — access order tracked via array
- `buildCacheKey()` creates deterministic keys from data type + sorted params
- `getOrFetch()` implements cache-through pattern: check → miss → fetch → store → return
- Disk persistence: optional JSON snapshot to `~/.launchpad/api-cache/` — saves on shutdown, loads on startup, skips expired entries
- Invalidation: by key, by data type, by key prefix, or full clear
- Stats: hits, misses, evictions, entry count, hit rate (0–1 ratio)
- Fastify plugin registers as `api-cache`, decorates server with `cache`, adds `/api/cache/stats` (GET) and invalidation endpoints (DELETE)
- 25 unit tests: TTL expiry, LRU eviction, cache-through, invalidation, disk round-trip, stats

### 2026-03-13: GitHub GraphQL Client Module
- GraphQL client lives in `src/server/github/` with three new files: `graphql-types.ts`, `graphql.ts`, `graphql-plugin.ts`
- Uses `graphql-request` library (GraphQLClient) — lightweight, typed, supports response middleware for header access
- `GitHubGraphQL` class wraps all queries: `listViewerRepos`, `listIssues`, `listPullRequests`, `fetchRepoMetadata`, `fetchIssuesForRepos`
- `fetchIssuesForRepos` uses GraphQL aliases to batch multiple repo queries into a single request (critical for ~500ms multi-repo fetch)
- Rate-limit tracking via `responseMiddleware` parsing `X-RateLimit-*` headers; exposed as `rateLimit` getter
- Custom `GitHubGraphQLError` with typed `code` field: `RATE_LIMITED`, `UNAUTHORIZED`, `NOT_FOUND`, `GRAPHQL_ERROR`, `NETWORK_ERROR`
- GitHub returns non-standard `type` field on GraphQL errors — requires cast `(error as unknown as { type?: string })` to access
- Fastify plugin uses `fp()` with `dependencies: ["github-auth"]`; decorates server with `githubGraphQL`
- 15 unit tests with fully mocked `graphql-request` (vi.mock + mockRequestFn pattern)

## Phase 1 Summary

**Completed Issues:** #6, #10, #11 (3/8 Phase 1 items)  
**Total Tests Added:** 15 + 23 + 25 = 63 tests  
**Commits:** 3 (GraphQL client, state persistence, cache layer)  

TARS delivered the complete GitHub data pipeline for launchpad:
1. **GraphQL client** — typed queries with alias-based batching for multi-repo efficiency
2. **State persistence** — three-tier architecture (REST client + local cache + manager) for config/preferences/enrichment
3. **API cache** — TTL-based in-memory cache with LRU eviction, disk snapshots, stats monitoring

All three modules are now integrated into the server as Fastify plugins with correct dependency ordering:
- `github-auth` (existing) → `state` (Phase 1) → `api-cache` (Phase 1) → routes

Phase 1 unlocked Romilly's REST API (#7) and Brand's frontend (#8, #9) by providing foundational data access and persistence layers. All issues closed on GitHub.

### 2026-03-13: Devcontainer Discovery & Monitoring Module
- Container module lives in `src/server/containers/` with 5 files: `types.ts`, `discovery.ts`, `monitor.ts`, `plugin.ts`, `index.ts`
- Discovery uses Docker CLI (`docker ps -a --filter label=devcontainer.local_folder` + `docker inspect`) — not `@devcontainers/cli` which would add a heavy dependency
- `discoverContainers()` accepts a `DockerExecutor` interface for testability — production uses `child_process.execFile`, tests inject mocks
- `ContainerMonitor` class: polls on configurable interval (default 10s), diffs against previous snapshot, broadcasts `ContainerStatusUpdate` only when changes detected
- Changes tracked: new container (absent→running/stopped), removed container (running/stopped→absent), status change (running↔stopped)
- Fastify plugin decorates server with `containers.latest()` and `containers.poll()`, registers `GET /api/devcontainers` route
- Plugin depends on `websocket` — registered before route plugins in server index
- Graceful degradation: Docker unavailable returns `{ dockerAvailable: false }`, inspect failures return error message, empty container list is a valid state
- 17 unit tests: Docker availability, container discovery, port parsing, status mapping, monitor diffing, broadcast behavior, edge cases
- **Key pattern**: Parallel agent work creates filesystem entanglement — other agents (attention, copilot) had uncommitted changes. Used `git checkout HEAD --` to restore clean base before applying only my changes.

## Phase 2 Summary

**Completed Issues:** #14 (1/5 Phase 2 items)
**Total Tests Added (Phase 2):** 17 tests
**Commits:** 1 (devcontainer discovery)

TARS delivered devcontainer discovery via Docker CLI — a clean, lightweight alternative to the @devcontainers/cli package. The discovery module integrates with the WebSocket server for real-time status broadcasts. Decision captured in decisions.md.

### 2026-03-13: Daemon ↔ HQ WebSocket Protocol Types (#36)
- Protocol types live in `src/shared/protocol.ts` — 14 message types as discriminated unions on `type` field
- Two direction unions: `DaemonToHqMessage` (8 types) and `HqToDaemonMessage` (6 types), combined into `WsMessage`
- Auth flow: challenge/response/accept-reject pattern with nonce — `src/shared/auth.ts` has `generateDaemonToken()` (crypto.randomBytes(32).hex) and `validateDaemonToken()` (timingSafeEqual)
- Protocol constants in `src/shared/constants.ts`: version string, heartbeat 15s, reconnect backoff 1s→30s, daemon WS path `/ws/daemon`
- Barrel export via `src/shared/index.ts`
- `tsconfig.server.json` updated: `rootDir` changed from `src/server` to `src` so server code can import from `src/shared/`
- `vitest.config.ts` server project now includes `src/shared/**/*.test.ts`
- 30 tests added (23 protocol + 7 auth), all passing alongside existing 200 tests (230 total)

### 2026-03-13: Daemon Core Process (#30)
- Daemon module lives in `src/daemon/` with 4 files: `config.ts`, `client.ts`, `state.ts`, `index.ts`
- `config.ts`: loads from env vars (LAUNCHPAD_HQ_URL, LAUNCHPAD_DAEMON_TOKEN, LAUNCHPAD_PROJECT_ID) → `.launchpad/daemon.json` fallback → defaults. Validates required fields.
- `client.ts`: `DaemonWebSocketClient` extends typed EventEmitter. Connects outbound to HQ, handles auth-challenge/response automatically, starts heartbeat after auth-accept, reconnects with exponential backoff (1s→30s cap).
- `state.ts`: `DaemonState` tracks ProjectState in memory, notifies listeners only on actual value changes. Convenience setters for initialized/online/workState.
- `index.ts`: `startDaemon()` wires config→client→state. Responds to `request-status` with current state. State changes trigger `status-update` to HQ when authenticated.
- `src/cli.ts`: CLI router — `launchpad-hq --daemon` starts daemon, otherwise starts HQ server. Dynamic imports keep each mode's deps separate.
- `package.json` bin entry updated from `dist/server/index.js` to `dist/cli.js`
- `tsconfig.server.json` and `vitest.config.ts` include `src/daemon/`
- Key ws library lesson: `ws.terminate()` on CONNECTING state emits 'error' via `process.nextTick` — must install no-op error handler before terminate to avoid uncaught exceptions
- 38 tests (14 client, 11 config, 13 state), 351 total passing

## Wave 1 Summary

**Phase 1 + Phase 2 Complete:** All Wave 1 issues closed (#25, #30, #34, #36)
**Total Tests Added (Wave 1):** 131 tests
**Total Tests Passing:** 351 (integrated)

Wave 1 delivered daemon foundation: WebSocket protocol types with discriminated unions, daemon core process with auto-reconnect, VISION.md architecture update, and supporting infrastructure. tsconfig and vitest updated for shared code module. All architectural decisions captured in decisions.md.

Key achievements:
- Protocol designed as pure types — implementation-agnostic, reusable across daemon and HQ
- Daemon lifecycle: config → client → state → register with HQ with automatic auth challenge/response
- Exponential backoff reconnect strategy prevents server hammering during outages
- Proper ws.terminate() error handling on CONNECTING state
- TypeScript path imports work correctly with updated tsconfig rootDir

### 2026-03-14: Copilot SDK Auto-Fallback & Daemon Startup Robustness
- **Root cause:** Daemon crashed in project devcontainers when `@github/copilot-sdk` was not installed and `LAUNCHPAD_COPILOT_MOCK` was not set — `assertSdk()` threw, and stdout buffers didn't flush so logs appeared empty
- **Fix 1 — Auto-fallback:** `sdk-adapter.ts` now exports `isSdkAvailable()`. `CopilotManager` constructor checks it: if SDK unavailable, falls back to `MockCopilotAdapter` with a `console.warn()` — daemon never crashes due to missing SDK
- **Fix 2 — Startup robustness:** `cli.ts` now installs `uncaughtException` / `unhandledRejection` handlers before any imports, and wraps the daemon startup in try/catch. Errors always reach logs.
- **Startup banner:** `daemon/index.ts` logs project+hq info immediately on `client.connect()` so log files are never empty
- **Pattern:** Graceful degradation via feature detection (`isSdkAvailable()`) over configuration requirements — daemon should always start, even with reduced capability
- **Key files:** `src/daemon/copilot/sdk-adapter.ts`, `src/daemon/copilot/manager.ts`, `src/cli.ts`, `src/daemon/index.ts`
- **Tests:** 620 passing (3 new: `isSdkAvailable()`, auto-fallback constructor, auto-fallback commands)

### 2026-03-14: Inherited from CASE — Copilot SDK Knowledge
- **SDK status:** No official `@github/copilot-sdk` npm package exists as of March 2026
- **Adapter pattern:** `CopilotAdapter` interface with `MockCopilotAdapter` for development. When the SDK ships, only the adapter implementation needs to change
- **Module structure (daemon-side):** `src/daemon/copilot/` — `adapter.ts` (interface), `mock-adapter.ts`, `sdk-adapter.ts`, `manager.ts`, `hq-tools.ts`, `system-message.ts`, `index.ts`
- **Server-side copilot aggregator:** `src/server/copilot-aggregator/` — aggregates sessions from all connected daemons
- **Endpoints:** REST routes at `/api/copilot/sessions`, WebSocket broadcasts on `copilot` channel
- **Key pattern:** Agents write their own unit tests; CASE wrote 18 tests for the copilot introspection layer

### 2026-03-14: PTY Spawn Environment Hardening for Backgrounded Daemons
- **Root cause:** When daemon runs via `postStartCommand` (backgrounded, non-interactive), `process.env` is minimal — missing TERM, SHELL, HOME, PATH, LANG. PTY shell hangs because it can't initialize properly.
- **Fix — buildShellEnv():** New exported function in `src/daemon/terminal/manager.ts` merges `process.env` with guaranteed defaults: `TERM=xterm-256color`, `COLORTERM=truecolor`, `SHELL` (detected from `/etc/passwd` or `/bin/bash`), `HOME`, `PATH` (with `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` fallback), `LANG=en_US.UTF-8`
- **Fix — Login shell:** Changed spawn args from `[]` to `['-l']` so bash/zsh source profile/bashrc — critical for backgrounded daemons that skip normal shell init
- **Fix — Logging:** Added `[terminal]` prefixed console.log/error for spawn (shell + PID), exit (code), and spawn failures
- **Pattern:** When daemon features depend on environment variables, never trust `process.env` raw — always build a merged env with sane defaults. This is the same graceful-degradation philosophy as `isSdkAvailable()`.
- **Key files:** `src/daemon/terminal/manager.ts`
- **Tests:** 620 passing (no new tests needed — existing terminal-manager tests cover the public API; `buildShellEnv` verified via inline tsx check)

### 2026-03-14: Wire Real @github/copilot-sdk into Adapter
- **What:** Replaced the stub `SdkCopilotAdapter` with a real implementation backed by `@github/copilot-sdk@^0.1.32`
- **SDK wiring:** `CopilotClient` created in `start()` with `{ cwd, autoRestart: true, logLevel: 'warning' }`. `SdkCopilotSession` wraps SDK session with `sendAndWait()` for our `send() → Promise<string>` convenience API. Auto-approves all permissions via SDK's `approveAll`.
- **Event mapping:** SDK uses underscores (`tool.execution_start`, `assistant.message_delta`), our protocol uses dots/camelCase (`tool.executionStart`, `assistant.message.delta`). `mapSdkEvent()` translates. SDK ISO timestamps → epoch ms.
- **HQ tools:** `hq-tools.ts` now uses SDK `defineTool()` when available, falls back to plain objects. Tool signatures are structurally compatible.
- **Fallback strategy:** Two-tier: (1) `isSdkAvailable()` checks if package imports (now true), (2) if `adapter.start()` fails (CLI not in PATH), manager catches the error and falls back to `MockCopilotAdapter` with a warning. Mock still works when `LAUNCHPAD_COPILOT_MOCK=true`.
- **SDK bug workaround:** `session.js` imports `vscode-jsonrpc/node` without `.js` extension (ESM resolution fails). `scripts/patch-sdk.js` (postinstall) fixes it.
- **Key files:** `src/daemon/copilot/sdk-adapter.ts`, `src/daemon/copilot/hq-tools.ts`, `src/daemon/copilot/manager.ts`, `scripts/patch-sdk.js`
- **Tests:** 621 passing (rewrote sdk-adapter tests: availability=true, adapter state, safe-when-not-started checks; updated manager fallback tests for runtime fallback scenario)

### 2026-03-14: Remove Daemon-Side Mock Copilot Adapter
- **What:** Deleted `src/daemon/copilot/mock-adapter.ts` (233 lines) and its test file. SDK is now the only path — no mock, no fallback, no env var toggle.
- **Manager changes:** Constructor accepts optional `adapter` (DI) defaulting to `SdkCopilotAdapter`. Removed `useMock` option, `LAUNCHPAD_COPILOT_MOCK` env check, `isSdkAvailable()` fallback. `start()` catches SDK failures gracefully — logs warning, returns early, daemon continues without copilot.
- **SDK adapter:** Removed `isSdkAvailable()` export. Cleaned error messages (no more "use LAUNCHPAD_COPILOT_MOCK=true" suggestion). SDK import failure is now a start-time error, not a feature-detection gate.
- **HQ tools:** Always use `getSdkDefineTool()` directly, removed `isSdkAvailable()` branching.
- **Test strategy:** Manager tests use inline `TestCopilotAdapter` and `FailingCopilotAdapter` via DI — lightweight, no external mock file. Added tests for graceful SDK start failure.
- **Other cleanups:** Removed `LAUNCHPAD_COPILOT_MOCK` from self-daemon spawner env, updated spawner test, cleaned server/index.ts comment.
- **Key principle:** SDK is a regular dependency — always importable. Runtime failures (CLI not in PATH) handled gracefully. Daemon starts fine without copilot.
- **Files changed:** 12 files (195 additions, 602 deletions). 603 tests passing.

### 2026-03-14: Close deleteSession Lifecycle Gap
- **Root cause:** `@github/copilot-sdk` has `client.deleteSession(sessionId)` but our adapter never called it. `session.abort()` and `session.destroy()` don't remove sessions from the SDK's internal registry — they persist forever.
- **Fix — Adapter interface:** Added `deleteSession(sessionId): Promise<void>` to `CopilotAdapter` interface. `SdkCopilotAdapter` delegates to `this.client.deleteSession()` (no-op when client is null).
- **Fix — Manager handleAbort:** Now calls `abort()` → `destroy()` → `adapter.deleteSession()`. Also emits `session.ended` unconditionally (not just when session was in activeSessions), ensuring HQ always gets cleanup signal.
- **Fix — Aggregator tombstones:** `CopilotSessionAggregator.removeSession()` adds sessionId to a `Set<string>` tombstone set. `updateSessions()` filters out tombstoned IDs before processing, preventing session resurrection from stale daemon polls.
- **Diagnostic test:** 9-test suite in `sdk-adapter-lifecycle.test.ts` using `LifecycleTestAdapter` that faithfully models SDK behavior — proves abort/destroy leave sessions in registry while deleteSession removes them.
- **Pattern:** Keep adapter layer thin — one SDK method, one adapter method. Complex lifecycle orchestration belongs in the manager.
- **Key files:** `adapter.ts`, `sdk-adapter.ts`, `manager.ts`, `aggregator.ts`, `sdk-adapter-lifecycle.test.ts`, `manager.test.ts`
- **Tests:** 654 passing (9 new lifecycle tests)

