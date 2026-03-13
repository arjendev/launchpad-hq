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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
