# Squad Decisions — Archive

> Decisions archived on 2026-03-14 during decisions.md condensation.
> These are implementation details, bug fixes, and completed research that are now captured in the codebase itself.
> The code is the source of truth for these patterns.

---

## Implementation Patterns (Archived)

### 2026-03-13: Technical — Scaffolding Config (TypeScript, ESLint, Vite, Build)
**By:** Cooper (Lead)
**What:** ESM-only (`"type": "module"`), TypeScript bundler moduleResolution, flat ESLint config (v9), Vite root at `src/client/`, proxy config for `/api` and `/ws` to localhost:3000, server on port 3000, bin entry `dist/server/index.js`. Server runs via `tsx` in dev, compiles to ESM for production.
**Why:** Modern Node.js + Vite alignment. Clean src/client/src/server separation. Single-package distribution via `npx launchpad-hq`.

### 2026-03-13: Technical — Fastify Server Architecture
**By:** Romilly (Backend Dev)
**What:** Routes via `FastifyPluginAsync` plugins in `src/server/routes/`. Centralized `loadConfig()` for env vars. Static serving only in production (dev uses Vite). CORS only in development (same-origin in production). Test files excluded from build but co-located with code.
**Why:** Encapsulation, testability via `server.inject()`, clean separation of concerns. No env-var sprawl.

### 2026-03-13: Technical — Client Shell Layout
**By:** Brand (Frontend Dev)
**What:** Mantine `AppShell` for header/main structure. Three-pane layout via `Flex` (250px / flex / 300px) + `ScrollArea` per pane, not Grid. Responsive toggle via `useMediaQuery("(max-width: 768px)")` for row/column direction on mobile.
**Why:** Direct control over proportions. `AppShell` handles header offset. Independent scrolling per pane. Simpler than Grid for this layout.

### 2026-03-13: Technical — GitHub Auth Module Pattern
**By:** TARS (Platform Dev)
**What:** GitHub authentication via `gh auth token` using `child_process.execFile`. Token validated against GitHub API, cached in-memory. Exposed as Fastify plugin decorating server with `githubToken` and `githubUser`. Custom `GitHubAuthError` with typed `code` field for clean error handling.
**Why:** `execFile` avoids shell injection. In-memory cache avoids repeated `gh` invocations. Fastify plugin pattern makes token/user available to all routes.

### 2026-03-13: Technical — Vitest Test Infrastructure
**By:** Doyle (Tester)
**What:** Vitest with workspace projects for separate server (Node) and client (jsdom) environments in single `vitest.config.ts`. Split test-utils: `src/test-utils/server.ts` (Fastify helpers) and `src/test-utils/client.tsx` (React/Mantine helpers). Client tests use custom `render()`. Server tests use `createTestServer()` + `server.inject()`. jsdom setup file polyfills `window.matchMedia`.
**Why:** Workspace projects avoid separate config files. Split test-utils prevent cross-environment import failures.

### 2026-03-13: Technical — graphql-request for GitHub GraphQL Client
**By:** TARS (Platform Dev)
**What:** Use `graphql-request` library for the GitHub GraphQL client, with batched alias queries for multi-repo fetches.
**Why:** Lightweight (~5KB) compared to full Octokit (~200KB). Native TypeScript support. GraphQL aliases enable batching N repo queries into 1 HTTP request.

### 2026-03-13: Technical — State Persistence Architecture
**By:** TARS (Platform Dev)
**What:** State persistence uses a three-layer design: GitHubStateClient (thin REST API wrapper for `launchpad-state` repo), LocalCache (on-disk JSON cache at `~/.launchpad/cache/` with SHA tracking), StateManager (read-through cache, write-through to GitHub). Three state files: `config.json` (tracked repos), `preferences.json` (user prefs), `enrichment.json` (devcontainer status, session links).
**Why:** Local cache gives sub-millisecond reads after first sync. SHA-tracked cache files enable conflict detection. Separate files avoid large-blob updates.

### 2026-03-13: Technical — Separate API Cache from State Cache
**By:** TARS (Platform Dev)
**What:** GitHub API response cache (`src/server/cache/`) is standalone, separate from state persistence `LocalCache`. API cache is TTL-based in-memory with LRU eviction; state cache manages durability with SHA tracking.
**Why:** Different concerns: state cache is for persistence correctness; API cache is for performance. Disk paths: state `~/.launchpad/cache/`, API cache `~/.launchpad/api-cache/`.

### 2026-03-13: Technical — WebSocket Server Architecture
**By:** Romilly (Backend Dev)
**What:** WebSocket server uses `ws` with `noServer: true` mode, handling HTTP upgrade on the `/ws` path. Connection tracking via `ConnectionManager` class with UUID-based client IDs and Set-based channel subscriptions. Three channels: `devcontainer`, `copilot`, `terminal`. JSON message protocol with `type` field routing. Heartbeat at 30s intervals.
**Why:** `noServer` mode gives full control over upgrade handling. Channel model matches the issue spec and keeps the subscription API simple.

### 2026-03-13: Technical — Project CRUD API Design
**By:** Romilly (Backend Dev)
**What:** Project management REST API with 5 endpoints covering full CRUD + discovery. Routes registered as Fastify plugin at `/api/projects` and `/api/discover/repos`. POST verifies repo exists via GitHub REST API before persisting. Case-insensitive duplicate detection. DELETE removes both the project entry and any enrichment data. Discovery endpoint marks tracked repos.
**Why:** Validation-first prevents data pollution. Discovery endpoint saves frontend from cross-referencing two lists.

### 2026-03-13: Technical — REST API route structure for GitHub data
**By:** Romilly (Backend Dev)
**What:** GitHub data routes (issues, PRs, overview, dashboard) live in a separate `github-data.ts` file rather than being added to the existing `projects.ts`. All project-scoped routes require the project to be tracked via stateService before hitting the GraphQL API.
**Why:** `projects.ts` owns CRUD for project tracking (state management). `github-data.ts` owns read-only GitHub data consumption (GraphQL queries). Dashboard endpoint uses `Promise.allSettled` so one failed repo doesn't take down the whole dashboard.

### 2026-03-13: Technical — Dashboard endpoint for project list data
**By:** Brand (Frontend Dev)
**What:** The project list panel uses `GET /api/dashboard` instead of `GET /api/projects` to populate the left pane.
**Why:** `/api/projects` only returns `{owner, repo, addedAt}` — no counts. `/api/dashboard` returns counts per project in a single API call.

### 2026-03-13: Technical — Kanban Column Classification Logic
**By:** Brand (Frontend Dev)
**What:** Issue-to-column mapping: `CLOSED` → Done; `OPEN` + assigned OR "in-progress" label → In Progress; remaining `OPEN` → Todo. Client-side classification.
**Why:** Matches GitHub-native workflow. Users can control column placement via assignees and labels.

### 2026-03-13: Technical — Full Stack launch profile — wire Vite preLaunchTask
**By:** Brand (Frontend Dev)
**What:** "Full Stack" compound launch profile now starts Fastify server + launches Vite via `preLaunchTask`. Added `"preLaunchTask": "dev:client"` to "Client (Debug)".
**Why:** Ensures Vite dev server is running before Chrome opens.

### 2026-03-13: Technical — WebSocket Client Architecture
**By:** Brand (Frontend Dev)
**What:** Single `WebSocketManager` class shared via React context (`WebSocketProvider`). Two hooks: `useWebSocket()` for raw access and `useSubscription(channel)` for typed channel subscriptions. Auto-reconnect with exponential backoff, message queuing during disconnects, channel re-subscription on reconnect.
**Why:** Single manager avoids multiple connections. Context provider prevents prop drilling.
**Impact:** All real-time features use `useSubscription(channel)`. Message protocol must stay in sync between client and server.

### 2026-03-13: Technical — Attention System Architecture
**By:** Romilly (Backend Dev)
**What:** Attention system at `src/server/attention/` uses rule engine pattern with pure evaluation functions, in-memory manager with configurable maxItems/LRU eviction, periodic evaluation via `setInterval`. Rules individually toggleable. WebSocket broadcasts on "attention" channel. Deterministic item IDs via SHA-256 hash.
**Why:** Pure rule functions are testable without mocking. In-memory storage sufficient for personal tool. Deterministic IDs preserve dismissed state.

### 2026-03-13: Theme System Architecture
**By:** Brand (Frontend Dev)
**What:** Wrapped Mantine's `useMantineColorScheme()` with thin `ThemeContext` adding `data-theme` attribute and `useTheme()` API. Custom CSS properties (`--lp-*`) in `src/client/styles/theme.css`. No-flash script in `index.html`.
**Why:** Mantine handles localStorage persistence, system preference detection. `--lp-*` CSS variables for custom styling outside Mantine components. Dark theme is default (mission control aesthetic).
**Impact:** Use `--lp-*` variables for custom colors, Mantine color props for components. `useTheme()` is the public API.

### 2026-03-13: Technical — Playwright E2E Testing Setup
**By:** Brand (Frontend Dev)
**What:** Playwright config: Chromium only, `webServer` auto-starts backend+frontend, `reuseExistingServer: true`, screenshots/traces on failure, 30s timeout, tests in `tests/e2e/`, run via `npm run test:e2e`.
**Why:** Unit tests missed real runtime errors. Playwright catches them by running actual Chromium.

### 2026-03-13: Architecture — Daemon registry dual-WebSocket pattern
**By:** Romilly (Backend Dev)
**What:** HQ runs two WebSocket servers on separate upgrade paths: `/ws` for browser clients, `/ws/daemon` for daemon connections. Both use `noServer: true` with separate upgrade handlers on the same HTTP server.
**Why:** Clean separation of concerns. Browser clients use channel-based pub/sub. Daemon clients use auth handshake + typed protocol messages. Different lifecycles, different security models.

### 2026-03-13: Architecture — CLI router and daemon module structure
**By:** TARS (Platform Dev)
**What:** Single CLI entry point (`src/cli.ts`) routes `--daemon` vs `--hq` mode. Daemon module in `src/daemon/`. Package bin entry points to `dist/cli.js`. Config priority: env vars → config file → defaults.
**Why:** Single package pattern (one npm install, two modes). Dynamic imports keep HQ deps out of daemon memory and vice versa.
**Impact:** `launchpad-hq --daemon` starts daemon; `launchpad-hq` starts HQ server. Env vars: LAUNCHPAD_HQ_URL, LAUNCHPAD_DAEMON_TOKEN, LAUNCHPAD_PROJECT_ID, LAUNCHPAD_DAEMON_CONFIG.

### 2026-03-13: Daemon ↔ HQ WebSocket Protocol Types
**By:** TARS (Platform Dev)
**What:** Foundational daemon ↔ HQ WebSocket protocol as TypeScript types in `src/shared/`. Every message has literal `type` discriminant. Two direction unions: `DaemonToHqMessage` (8 types), `HqToDaemonMessage` (6 types). Auth: challenge/response with nonce and `timingSafeEqual`.
**Why:** Foundation for daemon architecture. Getting protocol contract right first prevents integration pain.
**Impact:** `src/shared/` is shared code location. `tsconfig.server.json` rootDir is `src/`.

---

## Bug Fixes & Lifecycle Decisions (Archived)

### 2026-03-13: Technical — Parallel Agent Filesystem Entanglement
**By:** Brand (Frontend Dev)
**What:** When two agents work in parallel on the same filesystem and branch, uncommitted changes intermingle. Lesson learned: parallel work should consider separate feature branches.
**Why:** Coordination risk. Future parallel work should coordinate commit timing.

### 2026-03-13: SDK message projectId injection
**By:** Romilly
**Status:** Implemented
**What:** Handler injects projectId from WS-to-daemonId mapping into SDK message payloads before emitting to registry. Aggregator uses daemonId as fallback.
**Why:** SDK sessions were arriving without projectId, defaulting to "unknown".

### 2026-03-13: Backend — Session Status Lifecycle Semantics
**By:** Romilly (Backend Dev)
**Status:** Implemented (Commit: 2f03e16)
**What:** Redefined session status lifecycle: `"idle"` = ready for input, `"active"` = processing prompt. Lifecycle: `session.start` → `idle`, `user.message` → `active`, `assistant.message` → `idle`.
**Why:** Sessions created via stub were unblockable — send-prompt guard rejects when `status === "active"`.

### 2026-03-13: UI — End Session Button Always Visible
**By:** Brand (Frontend Dev)
**Status:** Implemented (Commit: 4b9e6dd)
**What:** Always-visible "✕ End" button in CopilotConversation header. Calls abort endpoint + navigates back. Works for sessions in any state.

### 2026-03-13: Backend — Session abort cleanup strategy
**By:** Romilly
**Status:** Implemented (Commit: c15a8fc)
**What:** Abort cleanup is dual-path and idempotent: (1) HQ removes session immediately after sending abort (instant UI update), (2) Daemon emits `session.ended` as safety net. Added `session.ended` to `CopilotSessionEventType` union.
**Why:** UI updates instantly even if daemon is disconnected.

### 2026-03-13: Frontend — Session abort cache invalidation
**By:** Brand
**Status:** Implemented (Commit: 1e7c8f7)
**What:** `useAbortSession` hook invalidates both `aggregated-sessions` and `copilot-sessions` cache keys after abort.
**Why:** Defensive caching — ensures no stale session data after "End" click.

### 2026-03-13: Quality — Copilot session lifecycle test coverage
**By:** Doyle (Quality Reviewer)
**Status:** Implemented
**What:** Added 34 integration tests covering complete Copilot session backend lifecycle.
**Why:** Session lifecycle code spans daemon registry, copilot aggregator, and HTTP routes — three integration seams that can break independently.

### 2026-03-14: Daemon — Add deleteSession to Close SDK Lifecycle Gap
**By:** TARS
**Status:** Implemented
**What:** Added `deleteSession(sessionId)` to `CopilotAdapter` interface. Manager `handleAbort()` now calls `abort()` → `destroy()` → `adapter.deleteSession()`. Aggregator tombstones prevent resurrection from stale daemon polls.
**Why:** Sessions persisted in SDK registry after users ended them.

### 2026-03-14: Architecture — SDK Big-Bang Refactor: Delete Adapter Layer
**By:** TARS (Implementation), Cooper (Audit)
**Status:** Implemented (Commit: 6c8f44c, f324c79)
**What:** Deleted adapter layer entirely. SDK types become wire types. Manager talks to `CopilotClient` directly. ~400 lines of mapping code deleted.
**Why:** Adapter added no value. SDK types are stable, well-typed, and wire-safe. Mapping layer actively caused bugs.
**Impact:** Client-side types in `src/client/services/types.ts` are now independent copies — need updating when client consumes SDK events directly.

### 2026-03-14: Decision: Disconnect-Before-Resume Pattern (SDK Sessions)
**By:** Romilly (Backend Dev)
**Status:** Implemented
**What:** Server resume route always sends `copilot-disconnect-session` before `copilot-resume-session`. Client disconnects ALL session types on switch. Client guards against re-selecting same session.
**Why:** Duplicate SDK session events caused by accumulated daemon-side event listeners.

### 2026-03-14: Decision: Triple Event Fix — CopilotManager Dedup Guards
**By:** Romilly (Backend Dev)
**Status:** Implemented
**What:** `CopilotManager.start()` is now idempotent (early return if `this.started`). `client.on()` handler skips events for active sessions. `trackSession()` accepts `skipInitialStart` param. Cleans up pre-existing unsubscriber before attaching new one.
**Why:** 3× duplicate entries in conversation viewer from three separate events per SDK event.

---

## Copilot SDK Agent Selection (Archived)

### 2026-03-14: Copilot SDK Custom-Agent Selection (Native Implementation)
**By:** TARS (Platform Dev)
**Status:** Implemented
**What:** Daemon-side agent selection uses Copilot SDK's native `customAgents` session config plus `session.rpc.agent.select()` / `deselect()`. Agent choices exposed to HQ as stable catalog.
**Why:** SDK 0.1.32 supports custom-agent registration. Stable catalog IDs let HQ remember per-project choices.
**Catalog:** Builtin "plain" session + discovered agents from `.github/agents/*.agent.md`. HQ persists as `defaultCopilotSdkAgent` on config.json.

### 2026-03-14: Brand: Remembered Copilot SDK Agent Picker
**By:** Brand (Frontend Dev)
**Status:** Implemented
**What:** Session-creation UI treats Copilot SDK agent choice as remembered per-project preference. Primary `Copilot SDK` action launches with remembered choice, alternate entries create with `Default` or discovered agent.
**Contract:** Persist on `config.json` as `defaultCopilotSdkAgent`. HQ exposes `GET`/`PUT /api/daemons/:owner/:repo/copilot/agents`. `POST .../copilot/sessions` accepts optional `agent` param.

### 2026-03-14: Copilot SDK Agent Preference Routes
**By:** Romilly (Backend Dev)
**Status:** Documented
**What:** Routes: `GET /api/daemons/:owner/:repo/copilot/agents` (read catalog + preference), `PUT .../agents` (update preference).
**Why:** Stable interface for per-project agent selection.

---

## Dev Tunnels Research & Implementation (Archived)

### 2026-03-14: Dev Tunnels Integration — Grooming
**By:** Cooper (Lead)
**Status:** Grooming complete, ready for implementation
**What:** Issue #23 grooming. Key decisions: (1) Temporary tunnels, not persistent. (2) Pre-login auth (user's responsibility). (3) Regex URL extraction from devtunnel stdout. (4) Adapt self-daemon spawner pattern. (5) Clear status codes: running/not_running/not_available/auth_failed/error. (6) `--tunnel` CLI flag.
**Files:** `src/cli.ts`, `src/server/config.ts`, `src/server/tunnel.ts`, `src/server/tunnel-plugin.ts`, `src/server/routes/tunnel.ts`, `src/server/index.ts`.

### 2026-03-14: DevTunnel Authentication Mechanisms Research
**By:** TARS (Daemon & SDK Specialist)
**Status:** Research complete
**Summary:** DevTunnel auth models: authenticated (default), anonymous (`--allow-anonymous`), token-based (issue bearer tokens), org-level. Phase 1: pre-login. Phase 2+: token-based for QR code (`devtunnel token TUNNELID --scopes connect --expiration 4h`). No official Node.js SDK — CLI is canonical interface.

### 2026-03-14: TunnelManager Implementation Pattern
**By:** TARS
**What:** Single-file module (`src/server/tunnel.ts`) wrapping `devtunnel` CLI via `child_process.spawn`/`execFile`. EventEmitter with singleton factory (`getTunnelManager()`). Anonymous + token hybrid auth. `resetTunnelManager()` for test isolation.

### 2026-03-14: Tunnel plugin uses fp (fastify-plugin) pattern
**By:** Romilly
**What:** Tunnel route plugin uses `fastify-plugin` (`fp`) exposing `tunnelManager` as Fastify instance decorator. Matches pattern used by `attention/plugin.ts` and `ws/plugin.ts`.
**Why:** `--tunnel` CLI flag needs `server.tunnelManager.start()` in `index.ts` after server boot. Without `fp`, decoration would be scoped.

### 2026-03-14: Tunnel UI uses REST polling, not WebSocket
**By:** Brand (Frontend Dev)
**What:** Tunnel status UI polls `GET /api/tunnel` every 5s via TanStack Query rather than WebSocket. Tunnel state changes infrequently. Upgrade path: switch to `useSubscription("tunnel")` if WS channel added later.

---

## Copilot SDK Auto-Fallback (Archived 2026-03-15)

### 2026-03-14: Copilot SDK Auto-Fallback to Mock
**By:** TARS
**Status:** Implemented
**What:** Feature-detect SDK availability, auto-fallback to mock with warning. `isSdkAvailable()` exported from `sdk-adapter.ts`. `CopilotManager` constructor: if SDK unavailable and not mock mode, use `MockCopilotAdapter` + `console.warn()`. Global `uncaughtException`/`unhandledRejection` handlers in `cli.ts`.
**Why:** Daemon should always start. Reduced capability is better than a crash.

---

## Onboarding Wizard Decomposition (Archived 2026-03-15)

### 2026-03-15: Onboarding Wizard Issue Decomposition
**By:** Cooper (Lead)
**Status:** Groomed — ready for implementation
**Issues Created:** #39–#45

| # | Title | Owner | Priority |
|---|-------|-------|----------|
| #39 | State management: local vs git persistence modes | Romilly | P1 |
| #40 | First-launch onboarding wizard (core framework) | Romilly + Brand | P0 |
| #41 | Onboarding step: State storage mode | Brand | P1 |
| #42 | Onboarding step: Copilot session preference | Brand | P1 |
| #43 | Onboarding step: Default Copilot model selection | Brand | P1 |
| #44 | Onboarding step: DevTunnel configuration | TARS + Brand | P1 |
| #45 | Fix: DevTunnel errors should not crash the server | TARS | P0 |

**Dependency:** #45 independent. #39 + #40 parallel. #41–#44 after #40.
**Architecture:** LaunchpadConfig at `~/.launchpad/config.json`. Wizard intercepts in `src/cli.ts` before server boot. LocalStateManager as second `StateService` impl.
