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

### 2026-03-13: Projects — GitHub repos + optional devcontainers
**By:** Arjen (via vision session)
**What:** A "project" is a GitHub repo with optional devcontainer enrichment. Explicit control with easy discoverability from user's own repos or any git URL.
**Why:** Repos are the base unit. Devcontainers are an enrichment layer for live status.

### 2026-03-13: Devcontainers — Dev Container CLI
**By:** Arjen (via vision session)
**What:** Use @devcontainers/cli for discovery and management. Spec-compliant approach.
**Why:** Standard tooling, works with existing devcontainer.json configs.

### 2026-03-13: Copilot — SDK deep integration
**By:** Arjen (via vision session)
**What:** Use GitHub Copilot SDK to query active sessions, read conversation state, and inject prompts.
**Why:** Deepest possible integration. Enables session introspection and steering from the dashboard.

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
**By:** Cooper (Lead)
**What:** Decomposed VISION.md into 28 concrete work items across 5 phases. Phase 0 (Foundation) contains 5 P0 items: scaffolding, server skeleton, client shell, auth, test infra. Phases 1–4 follow with 7+6+5+5 items respectively. Maximizes parallelism within phases, minimizes cross-agent blocking.
**Why:** Clear scope, prioritization, and team lane assignments. Single-package structure from Phase 0. GitHub API (TARS) → REST endpoints (Romilly) clean boundary. WebSocket before push features. xterm split between Brand and Romilly.

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
