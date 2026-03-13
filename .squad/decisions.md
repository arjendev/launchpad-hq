# Squad Decisions

## Active Decisions

### 2026-03-13: Product — launchpad-hq npm package name
**By:** Arjen (via vision session)
**What:** npm package name is `launchpad-hq`. "launchpad" was taken. Command: `npx launchpad-hq`
**Why:** Available on npm, keeps the launchpad brand, "headquarters" fits the mission control metaphor

### 2026-03-13: Architecture — Local web server + devtunnels
**By:** Arjen (via vision session)
**What:** React web app served by local Fastify server. Phone access via Microsoft Dev Tunnels. No hosted services.
**Why:** Desktop has direct access to devcontainers/copilot sessions. Devtunnel bridges phone to desktop. One server, full experience everywhere.

### 2026-03-13: State — User's own GitHub state repo
**By:** Arjen (via vision session)
**What:** Every user creates their own `launchpad-state` repo for state management and overarching issues. Local cache for speed.
**Why:** No hosted services needed. GitHub is the persistence layer. Versioned, portable, accessible from any device.

### 2026-03-13: Data — GitHub Issues + local enrichment
**By:** Arjen (via vision session)
**What:** GitHub Issues are the source of truth for tasks. Launchpad caches and enriches them locally with devcontainer status, session links, and custom metadata.
**Why:** GitHub-native workflow + custom enrichment. GraphQL API makes fetching 10+ repos fast (~500ms).

### 2026-03-13: Projects — GitHub repos with runtime targets
**By:** Arjen (via vision session) — *updated after daemon architecture pivot*
**What:** A "project" is a GitHub repo with an explicit runtime target (WSL+devcontainer, WSL only, or local folder). Each project runs a daemon that reports state back to HQ. Explicit control with easy discoverability from user's own repos or any git URL.
**Why:** Repos are the base unit. Daemons provide live status via WebSocket push. Runtime target determines where the daemon runs.

### 2026-03-13: Copilot — SDK deep integration via daemon
**By:** Arjen (via vision session) — *updated: real SDK confirmed*
**What:** Use `@github/copilot-sdk` (technical preview) via the daemon. Daemon spawns `CopilotClient({ cliPath: "copilot" })`, discovers sessions via `listSessions()`, streams events via `session.on()`, injects prompts via `session.send()`, and registers custom HQ-aware tools via `defineTool()`. HQ only aggregates — never talks to the SDK directly.
**Why:** Deepest possible integration. Daemon is the SDK bridge; HQ is the dashboard. See also: "Daemon is the Copilot SDK bridge" and "Copilot SDK is real" decisions.

### 2026-03-13: Session attach — Full takeover via xterm.js
**By:** Arjen (via vision session)
**What:** Attach to session terminal/context and operate as if sitting in front of it. Full control via xterm.js.
**Why:** Maximum flexibility. Not just observing — actually steering.

### 2026-03-13: UI — Three-pane mission control dashboard
**By:** Arjen (via vision session)
**What:** Left panel: project list. Center: selected project's kanban board. Right: live session panel. Badge counts with red/yellow/green color coding for attention.
**Why:** Mission control metaphor. Everything visible at a glance. Progressive depth.

### 2026-03-13: Auth — gh CLI
**By:** Arjen (via vision session)
**What:** Use `gh auth token` for authentication. Users must have gh CLI installed and authenticated.
**Why:** Zero-friction for GitHub CLI users. No OAuth dance, no token management.

### 2026-03-13: Stack — React + Vite + TanStack + Mantine + Fastify
**By:** Arjen (via vision session)
**What:** Frontend: React, Vite, TanStack Query/Router, Mantine, xterm.js. Backend: Fastify, WebSocket (ws). Single monorepo package (src/client + src/server). Light + dark theme toggle.
**Why:** TanStack Query perfect for GitHub API polling/caching. Mantine is dashboard-ready with rich components. Fastify is modern and fast. Single package simplifies npx distribution.

### 2026-03-13: User model — Single user, personal tool
**By:** Arjen (via vision session)
**What:** Launchpad is a personal mission control. One user, one state repo, one instance.
**Why:** Simplifies auth, state management, and UX. No multi-tenancy concerns.

### 2026-03-13T08:56:00Z: User directive — model preference
**By:** Arjen (via Copilot)
**What:** All squad members use claude-opus-4.6 except Scribe, who stays on claude-haiku-4.5.
**Why:** User request — captured for team memory

### 2026-03-13T09:30:00Z: User directive — Arjen as human reviewer
**By:** Arjen (via Copilot)
**What:** Arjen joins the team as a human reviewer. Any important decision that fundamentally changes direction must be reviewed by Arjen before proceeding. "Important" means costly to revert: data model changes, framework switches, persistence layer, API surface redesign, product direction pivots. Routine implementation choices (naming, file structure, minor refactors) do NOT require review.
**Why:** User request — ensures human oversight on high-impact decisions

### 2026-03-13T10:03:00Z: User directive — VS Code launch profiles for dev servers
**By:** Arjen (via Copilot)
**What:** Client (Vite) and server (Fastify) must always be started via VS Code launch profiles (.vscode/launch.json), never via raw CLI commands (npm run dev, tsx watch, vite). This ensures terminal output is visible in VS Code's integrated terminal UI. Build commands (npm run build, npm run typecheck) and test commands (npm test) are still allowed in bash.
**Why:** User request — dev server output must be visible in VS Code UI

### 2026-03-13: Technical — Work Decomposition & Phasing
**By:** Cooper (Lead) — *updated after daemon architecture pivot*
**What:** Original 28 items across 5 phases (Phase 0–4). Phase 0 (Foundation) and Phase 1 (Core Features) complete. After the daemon architecture pivot, the backlog was re-scoped: 10 original issues kept (some re-scoped), 8 new issues created (#29–#38). Current execution waves: **Wave 1** (done): WS protocol #36, theme #25, daemon core #30, daemon registry #34. **Wave 2**: project model #31, Copilot forwarding #29, self-registration #32, terminal relay #20, SDK integration #37, custom tools #38. **Wave 3**: Docker removal #33, xterm.js #19, conversation viewer #22, prompt injection #21. **Wave 4**: Dev Tunnels #23, attention badges #24, daemon health #35, error handling #26, e2e tests #27, API tests #28.
**Why:** Clear scope, prioritization, and team lane assignments. Daemon architecture pivot changed the execution order significantly — environment introspection now flows through daemons, not Docker.

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
**Why:** `execFile` avoids shell injection. In-memory cache avoids repeated `gh` invocations. Fastify plugin pattern makes token/user available to all routes. Custom error class enables clean startup error handling without stack traces.

### 2026-03-13: Technical — Vitest Test Infrastructure
**By:** Doyle (Tester)
**What:** Vitest with workspace projects for separate server (Node) and client (jsdom) environments in single `vitest.config.ts`. Split test-utils: `src/test-utils/server.ts` (Fastify helpers) and `src/test-utils/client.tsx` (React/Mantine helpers). Client tests use custom `render()`. Server tests use `createTestServer()` + `server.inject()`. jsdom setup file polyfills `window.matchMedia`.
**Why:** Workspace projects avoid separate config files. Split test-utils prevent cross-environment import failures. `server.inject()` is fast and doesn't require port allocation. Custom render centralizes provider boilerplate.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

### 2026-03-13: Technical — graphql-request for GitHub GraphQL Client
**By:** TARS (Platform Dev)
**What:** Use `graphql-request` library for the GitHub GraphQL client, with batched alias queries for multi-repo fetches.
**Why:** Lightweight (~5KB) compared to full Octokit (~200KB). Native TypeScript support, response middleware for header access (rate-limit tracking). GraphQL aliases enable batching N repo queries into 1 HTTP request — critical for the ~500ms multi-repo target.

### 2026-03-13: Technical — State Persistence Architecture
**By:** TARS (Platform Dev)
**What:** State persistence uses a three-layer design: GitHubStateClient (thin REST API wrapper for `launchpad-state` repo), LocalCache (on-disk JSON cache at `~/.launchpad/cache/` with SHA tracking), StateManager (read-through cache, write-through to GitHub). Three state files: `config.json` (tracked repos), `preferences.json` (user prefs), `enrichment.json` (devcontainer status, session links).
**Why:** Local cache gives sub-millisecond reads after first sync. SHA-tracked cache files enable conflict detection for future optimistic locking. Separate files avoid large-blob updates. DI pattern keeps the class testable.

### 2026-03-13: Technical — Separate API Cache from State Cache
**By:** TARS (Platform Dev)
**What:** The GitHub API response cache (`src/server/cache/`) is a standalone module, completely separate from the state persistence `LocalCache`. API cache is TTL-based in-memory with LRU eviction; state cache manages durability with SHA tracking.
**Why:** Different concerns: state cache is for persistence correctness; API cache is for performance. Merging them would conflate durability guarantees with performance caching. Disk paths: state `~/.launchpad/cache/`, API cache `~/.launchpad/api-cache/`.

### 2026-03-13: Technical — WebSocket Server Architecture
**By:** Romilly (Backend Dev)
**What:** WebSocket server uses `ws` with `noServer: true` mode, handling HTTP upgrade on the `/ws` path. Registered as a Fastify plugin before route plugins. Connection tracking via `ConnectionManager` class with UUID-based client IDs and Set-based channel subscriptions. Three channels defined: `devcontainer`, `copilot`, `terminal`. JSON message protocol with `type` field routing. Heartbeat at 30s intervals.
**Why:** `noServer` mode gives full control over upgrade handling — no path conflicts with Fastify's own routing. Plugin registration before routes ensures `server.ws.broadcast()` decorator is available to all downstream route plugins. Channel model matches the issue spec and keeps the subscription API simple.

### 2026-03-13: Technical — Project CRUD API Design
**By:** Romilly (Backend Dev)
**What:** Project management REST API with 5 endpoints covering full CRUD + discovery. Routes registered as Fastify plugin at `/api/projects` and `/api/discover/repos`. POST verifies repo exists via GitHub REST API before persisting. Case-insensitive duplicate detection. DELETE removes both the project entry and any enrichment data. Discovery endpoint marks tracked repos.
**Why:** Validation-first prevents data pollution. Better to fail on add than discover broken state later. Discovery endpoint saves frontend from cross-referencing two lists. State plugin now wired in correct dependency ordering: `github-auth` → `state` → routes.

### 2026-03-13: Technical — REST API route structure for GitHub data
**By:** Romilly (Backend Dev)
**What:** GitHub data routes (issues, PRs, overview, dashboard) live in a separate `github-data.ts` file rather than being added to the existing `projects.ts`. All project-scoped routes require the project to be tracked via stateService before hitting the GraphQL API.
**Why:** `projects.ts` owns CRUD for project tracking (state management). `github-data.ts` owns read-only GitHub data consumption (GraphQL queries). Clean separation of concerns. Dashboard endpoint uses `Promise.allSettled` so one failed repo doesn't take down the whole dashboard. Label/assignee filtering on issues is done client-side.

### 2026-03-13: Technical — Dashboard endpoint for project list data
**By:** Brand (Frontend Dev)
**What:** The project list panel uses `GET /api/dashboard` instead of `GET /api/projects` to populate the left pane. This gives us issue/PR counts per project in a single API call rather than requiring N+1 requests.
**Why:** `/api/projects` only returns `{owner, repo, addedAt}` — no counts or metadata. `/api/dashboard` returns `{owner, repo, openIssueCount, openPrCount, updatedAt, isArchived}` per project. Single request for the whole list vs. fan-out.

### 2026-03-13: Technical — Kanban Column Classification Logic
**By:** Brand (Frontend Dev)
**What:** Issue-to-column mapping: `CLOSED` → Done; `OPEN` + assigned OR "in-progress" label → In Progress; remaining `OPEN` → Todo. Client-side classification (no server changes needed).
**Why:** Matches GitHub-native workflow. Users can control column placement via assignees and labels. Read-only view keeps complexity low; drag-and-drop can be layered on later without changing the classification function.

### 2026-03-13: Technical — Parallel Agent Filesystem Entanglement
**By:** Brand (Frontend Dev)
**What:** When two agents (#8 and #9) work in parallel on the same filesystem and branch, uncommitted changes intermingle. #8's commit included #9's KanbanBoard changes because both were staged in the same working tree.
**Why:** This is a coordination risk. Future parallel work should consider separate feature branches that merge via PR, or at minimum, agents should coordinate commit timing to avoid capturing each other's work.

### 2026-03-13: Technical — Full Stack launch profile — wire Vite preLaunchTask
**By:** Brand (Frontend Dev)
**What:** The "Full Stack" compound launch profile now starts the Fastify server + launches Vite via `preLaunchTask`. Added `"preLaunchTask": "dev:client"` to the "Client (Debug)" configuration.
**Why:** Ensures Vite dev server is running before Chrome opens at `localhost:5173`. "Full Stack" now launches Server (Debug) + Client (Debug) correctly.

### 2026-03-13: Technical — WebSocket Client Architecture
**By:** Brand (Frontend Dev)
**What:** WebSocket client uses a single `WebSocketManager` class instance shared via React context (`WebSocketProvider`). Two hooks: `useWebSocket()` for raw access and `useSubscription(channel)` for typed channel subscriptions. Manager handles auto-reconnect with exponential backoff, message queuing during disconnects, and channel re-subscription on reconnect.
**Why:** Single manager avoids multiple connections. Context provider prevents prop drilling. `useSubscription` returns `{ data, status }` — simple API for real-time channel data. Message queuing (capped at 100) prevents lost messages during brief disconnects. Exponential backoff (1s → 30s max) avoids hammering the server during outages.
**Impact:** All real-time features (devcontainer status, copilot sessions, terminal) use `useSubscription(channel)`. ConnectionStatus badge in header. Message protocol must stay in sync between client and server.

### 2026-03-13: Technical — Attention System Architecture
**By:** Romilly (Backend Dev)
**What:** Attention system at `src/server/attention/` uses a rule engine pattern with pure evaluation functions, an in-memory manager with configurable maxItems/LRU eviction, and periodic evaluation via `setInterval`. Rules are individually toggleable. WebSocket broadcasts on "attention" channel. Deterministic item IDs via SHA-256 hash for stable deduplication.
**Why:** Pure rule functions are testable without mocking. In-memory storage is fast and sufficient for a personal tool. Deterministic IDs preserve dismissed state when items are re-evaluated. `Promise.allSettled` prevents one failing project from blocking others. Stubs for CI-failing and session-idle rules are ready.
**Impact:** Attention badge in header shows count. Rule stubs await Checks API and Copilot SDK integration.

### 2026-03-13T13:56:00Z: Architecture — Hub-and-spoke daemon architecture
**By:** Arjen (via architecture discussion)
**What:** Launchpad uses a hub-and-spoke model. launchpad-hq is the central dashboard (hub). Each project devcontainer runs a launchpad-daemon (spoke). Daemons initiate bidirectional WebSocket connections outbound to HQ. HQ never reaches into daemons. This preserves devcontainer isolation. Dev Tunnels will be added later for remote/Codespaces support. The current Docker-based discovery (#14) should be replaced or supplemented with daemon registration. This devcontainer runs BOTH HQ and its own daemon since it is also a project.
**Why:** Architectural decision — defines how multi-project introspection works. Affects discovery, terminal relay, copilot session forwarding, and the entire Phase 3 scope.

### 2026-03-13T14:10:00Z: Architecture — Project lifecycle model
**By:** Arjen (via architecture discussion)
**What:** When a project is added in HQ, the user specifies the runtime target: WSL+devcontainer, WSL only, or local folder. Each project has lifecycle states: initialized (yes/no), daemon status (online/offline), work state (working/awaiting/stopped). Daemons are started explicitly, not auto-spawned. The daemon runs in whatever environment the project lives in — not just devcontainers.
**Why:** Defines the project model for the daemon architecture. Affects project CRUD, daemon management, and the entire dashboard UX.

### 2026-03-13T14:23:00Z: Architecture — Daemon is the Copilot SDK bridge
**By:** Arjen (via architecture clarification)
**What:** The launchpad-daemon's primary interface with the local project is through the Copilot SDK. The Copilot SDK adapter (currently in src/server/copilot/) belongs in the daemon, not in HQ. The daemon discovers local Copilot sessions via the SDK, relays conversation state and session status to HQ, and executes HQ commands (prompt injection, session attach) locally via the SDK. HQ only aggregates — it never talks to the SDK directly. When the real Copilot SDK ships, only the daemon's adapter internals change.
**Why:** Defines the daemon's core purpose and the correct location for Copilot SDK integration. Affects NEW-6 (Copilot forwarding) and #21 (prompt injection) scope.

### 2026-03-13: Technical — Playwright E2E Testing Setup
**By:** Brand (Frontend Dev)
**What:** Playwright is now set up as the browser-level E2E testing tool. Configuration: only Chromium (fast, sufficient for dashboard), `webServer` config starts both backend and frontend automatically, `reuseExistingServer: true` so devs can use running servers, screenshots on failure, traces on failure, 30s timeout per test, tests live in `tests/e2e/`, run via `npm run test:e2e`.
**Why:** Unit tests (vitest + jsdom) missed a real runtime error: the copilot sessions hook was consuming a wrapped API response as a raw array, causing `TypeError: sessions.map is not a function` in real browsers. Playwright catches these by running actual Chromium.
**Impact:** All frontend PRs should run `npm run test:e2e` to validate browser behavior. New frontend features should include Playwright smoke tests. Chromium binary is cached in `~/.cache/ms-playwright/` (~110MB).

### 2026-03-13T11:27:30Z: User directive — Playwright browser tests required
**By:** Arjen (via Copilot)
**What:** Brand must always run Playwright browser tests to verify frontend changes actually work in a real browser. Curl-based smoke tests are insufficient — they miss runtime errors like null reference crashes that only manifest after initial render.
**Why:** User request — captured for team memory. Multiple runtime bugs (WebSocket Strict Mode crash, post-load error) were missed by unit tests and curl checks.

### 2026-03-13: Theme System Architecture
**By:** Brand (Frontend Dev)
**Date:** 2026-03-13
**Issue:** #25
**What:** Wrapped Mantine's `useMantineColorScheme()` + `useComputedColorScheme()` with a thin `ThemeContext` that adds a `data-theme` attribute and a simpler `useTheme()` API. Custom CSS properties (`--lp-*`) defined in `src/client/styles/theme.css` keyed off Mantine's `[data-mantine-color-scheme]` selector. No-flash script in `index.html` reads localStorage before React hydrate.
**Why:** Mantine already handles localStorage persistence, system preference detection, and automatic component retheming — no reason to duplicate. The `--lp-*` CSS variables give escape hatches for custom styling outside Mantine components. `data-theme` attribute enables CSS selectors independent of Mantine internals.
**Impact:** All future components should use `--lp-*` variables for custom colors and Mantine color props for component-level theming. `useTheme()` hook is the public API — don't use Mantine hooks directly. Dark theme is the default (mission control aesthetic).

### 2026-03-13T14:30:00Z: Copilot SDK is real — update integration approach
**By:** Arjen (via SDK review)
**What:** The GitHub Copilot SDK (`@github/copilot-sdk`) exists and is in technical preview. Provides: CopilotClient (JSON-RPC to CLI), listSessions(), resumeSession(), createSession(), session.send(), event streaming (assistant.message, tool.*, session.idle), session hooks (onPreToolUse, onPostToolUse, onUserPromptSubmitted), and custom tools. The daemon should use this SDK directly — connecting to the local Copilot CLI via `cliUrl` option. MockCopilotAdapter pattern is correct but interface must be expanded to match real SDK surface.
**Why:** Foundational architectural decision — affects #21 (prompt injection), #22 (conversation viewer), #29 (Copilot forwarding), and daemon Copilot integration layer.
**Impact:** When SDK becomes stable, update `src/daemon/copilot-adapter.ts` to use `CopilotClient` from `@github/copilot-sdk`. No changes to protocol or interface contracts needed.

### 2026-03-13: Architecture — Daemon registry dual-WebSocket pattern
**By:** Romilly (Backend Dev)
**What:** HQ runs two WebSocket servers on separate upgrade paths: `/ws` for browser clients (existing), `/ws/daemon` for daemon connections (new). Both use `noServer: true` with separate upgrade handlers on the same HTTP server.
**Why:** Clean separation of concerns. Browser clients use channel-based pub/sub (subscribe/unsubscribe). Daemon clients use auth handshake + typed protocol messages. Different lifecycles, different security models. Browser WS plugin modified to NOT `socket.destroy()` on unknown paths — lets daemon handler pick up `/ws/daemon` connections.
**Impact:** Any future WebSocket paths (e.g. `/ws/admin`) should follow this pattern: separate WebSocketServer, separate upgrade handler, no socket.destroy() on non-matching paths. Token lookup in daemon-registry currently undefined — TODO: wire to stateService.getDaemonToken(projectId) once tokens persisted.

### 2026-03-13: Architecture — CLI router and daemon module structure
**By:** TARS (Platform Dev)
**What:** Single CLI entry point (`src/cli.ts`) routes `--daemon` vs `--hq` mode. Daemon module in `src/daemon/` with config/client/state/index files. Package bin entry points to `dist/cli.js`. Config priority: env vars → config file → defaults.
**Why:** Single package pattern (one npm install, two modes). Dynamic imports keep HQ deps out of daemon memory and vice versa. Config pattern matches 12-factor app for container deployments.
**Impact:** `launchpad-hq --daemon` starts daemon; `launchpad-hq` starts HQ server. Environment variables: LAUNCHPAD_HQ_URL, LAUNCHPAD_DAEMON_TOKEN, LAUNCHPAD_PROJECT_ID, LAUNCHPAD_DAEMON_CONFIG.

### 2026-03-13: Daemon ↔ HQ WebSocket Protocol Types
**Date:** 2026-03-13
**By:** TARS (Platform Dev)
**Issue:** #36
**Status:** Implemented
**What:** Defined foundational daemon ↔ HQ WebSocket protocol as TypeScript types in `src/shared/`. Every message has a literal `type` discriminant (switch/case narrowing works automatically). Two direction unions: `DaemonToHqMessage` (8 types), `HqToDaemonMessage` (6 types), combined into `WsMessage`. Auth flow: challenge/response pattern with nonce. Token is 32 random bytes hex-encoded, validated with `timingSafeEqual`. 14 message types total. `tsconfig.server.json` rootDir changed from `src/server` to `src` to support cross-directory imports.
**Why:** Foundation for entire daemon architecture. Issues #30 and #34 directly depend on these types. Getting protocol contract right first prevents integration pain later.
**Impact:** `src/shared/` is new shared code location. Any code consumed by both HQ and daemon lives here. `tsconfig.server.json` rootDir now `src/` (build output path `dist/server/index.js` remains stable). Vitest server project now includes `src/shared/` tests.

### 2026-03-13: Architecture — Daemon responsibilities and Copilot SDK integration spec
**By:** Arjen (via brainstorm session)
**What:** Defined 10 daemon responsibilities mapped to the real `@github/copilot-sdk`: (1) SDK lifecycle manager — `CopilotClient({ cliPath: "copilot", autoRestart: true })`; (2) Session discovery — `listSessions()` on startup + periodic polling; (3) Session creation from HQ — `createSession({ model, tools, systemMessage })`; (4) Session resume from HQ — `resumeSession(id, { tools })`; (5) Full event firehose — `session.on()` streams ALL events to HQ (messages, reasoning, tools, lifecycle); (6) Prompt injection — `session.send({ prompt, attachments? })` + `session.abort()`; (7) Custom HQ-aware tools — `defineTool()` for `report_progress`, `request_human_review`, `report_blocker`; (8) System message injection — append mode with project context + tool instructions; (9) Project state — git status, branch info; (10) Terminal PTY — `node-pty` for manual access. HQ server receives full firehose and filters before forwarding to browser. Issues: #37 (SDK integration), #38 (custom tools).
**Why:** Defines the complete daemon-SDK contract before implementation. All session management flows through the daemon; HQ only aggregates and relays. Custom tools make agents HQ-aware automatically.
**Impact:** Protocol needs expansion with new message types for SDK state, session events, tool invocations, and session commands. VISION.md updated with "Daemon Responsibilities" section.

### 2026-03-14: Copilot SDK Auto-Fallback to Mock
**By:** TARS
**Date:** 2026-03-14
**Status:** Implemented
**What:** Feature-detect SDK availability, auto-fallback to mock with a warning. `isSdkAvailable()` exported from `sdk-adapter.ts` — single source of truth. `CopilotManager` constructor: if `!useMock && !isSdkAvailable()` → use `MockCopilotAdapter` + `console.warn()`. `cli.ts`: global `uncaughtException` / `unhandledRejection` handlers installed before any imports; daemon startup wrapped in try/catch. `daemon/index.ts`: startup banner logged immediately on connect so logs are never empty.
**Why:** Daemon should always start — reduced capability (mock copilot) is better than a crash. Configuration-free: no env vars required for basic operation. When the real SDK ships, the fallback disappears automatically (sdkAvailable becomes true). Global error handlers ensure any future crash also produces visible log output.
**Impact:** No behavior change when `LAUNCHPAD_COPILOT_MOCK=true` (still uses mock directly). No behavior change when SDK is installed (still uses real adapter). New behavior: SDK missing + no mock env → graceful degradation to mock with warning.
