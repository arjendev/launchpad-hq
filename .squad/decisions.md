# Squad Decisions

## Product Vision

> Established 2026-03-13 by Arjen. These define what launchpad IS.

- **Package:** `launchpad-hq` on npm. Command: `npx launchpad-hq`
- **Architecture:** React web app served by local Fastify server. Phone access via Microsoft Dev Tunnels. No hosted services.
- **State:** Every user creates their own `launchpad-state` repo. GitHub is the persistence layer. Local cache for speed.
- **Data:** GitHub Issues are the source of truth for tasks. Launchpad caches and enriches them locally with devcontainer status, session links, and custom metadata. GraphQL API for fast multi-repo fetching (~500ms).
- **Projects:** A "project" is a GitHub repo with an explicit runtime target (WSL+devcontainer, WSL only, or local folder). Each project runs a daemon that reports state back to HQ.
- **Copilot:** Use `@github/copilot-sdk` (technical preview) via the daemon. Daemon spawns `CopilotClient`, discovers sessions, streams events, injects prompts, registers custom tools. HQ only aggregates — never talks to SDK directly.
- **Session attach:** Full terminal takeover via xterm.js. Not just observing — actually steering.
- **UI:** Three-pane mission control. Left: project list. Center: kanban board. Right: live session panel. Badge counts with color coding.
- **Auth:** `gh auth token` for authentication. Users must have gh CLI installed and authenticated.
- **Stack:** Frontend: React, Vite, TanStack Query/Router, Mantine, xterm.js. Backend: Fastify, WebSocket (ws). Single monorepo package (src/client + src/server). Light + dark theme toggle.
- **User model:** Personal mission control. One user, one state repo, one instance. No multi-tenancy.

---

## User Directives

> Rules from Arjen. These MUST be respected by all agents.

### Model preference (2026-03-13)
All squad members use claude-opus-4.6 except Scribe, who stays on claude-haiku-4.5.

### Arjen as human reviewer (2026-03-13)
Any important decision that fundamentally changes direction must be reviewed by Arjen before proceeding. "Important" means costly to revert: data model changes, framework switches, persistence layer, API surface redesign, product direction pivots. Routine implementation choices do NOT require review.

### VS Code launch profiles for dev servers (2026-03-13)
Client (Vite) and server (Fastify) must always be started via VS Code launch profiles (`.vscode/launch.json`), never via raw CLI commands. Build commands (`npm run build`, `npm run typecheck`) and test commands (`npm test`) are still allowed in bash.

### Playwright browser tests required (2026-03-13)
Brand must always run Playwright browser tests to verify frontend changes. Curl-based smoke tests are insufficient — they miss runtime errors that only manifest after initial render.

### Dev Tunnel UI (2026-03-14)
Dev Tunnel UI should be a clickable element in the top bar (right side). Clicking shows a QR code. Scanning QR code should authenticate/log you in on the remote device.

### Native Copilot SDK delegation (2026-03-14)
Prefer native Copilot SDK custom-agent coordination if it already supports delegation; avoid adding an explicit coordinator marker unless there is a concrete gap.

---

## Architecture — Hub-and-Spoke Daemon Model

> Established 2026-03-13 by Arjen. Foundational architecture.

**Hub-and-spoke model:** launchpad-hq is the central dashboard (hub). Each project devcontainer runs a launchpad-daemon (spoke). Daemons initiate bidirectional WebSocket connections outbound to HQ. HQ never reaches into daemons. Dev Tunnels for remote/Codespaces support.

**Daemon is the Copilot SDK bridge:** The daemon discovers local Copilot sessions via the SDK, relays conversation state and session status to HQ, and executes HQ commands (prompt injection, session attach) locally. HQ only aggregates — never talks to SDK directly.

**Single binary:** `launchpad-hq --daemon` starts daemon; `launchpad-hq` starts HQ server. Dynamic imports keep HQ deps out of daemon memory and vice versa.

**Dual-WebSocket:** HQ runs `/ws` for browser clients (channel-based pub/sub) and `/ws/daemon` for daemon connections (auth handshake + typed protocol). Protocol types in `src/shared/` with literal `type` discriminants.

---

## Code Architecture Principles

> Established 2026-03-21 during #76 refactor. All agents must follow these.

1. **Route files are thin** — request validation → service call → response. No business logic, no event wiring, no service instantiation.
2. **One message router per boundary** — daemon has one central router, server has one central handler. No scattered `on('message')` handlers.
3. **Typed events only** — no `as never`, no `emit(string, any)`. Every event has a typed map entry.
4. **Broadcasts from consumers** — the daemon handler emits events to the bus; consumer plugins decide what to broadcast to browsers.
5. **No module-level mutable state** — all state in classes, registered as Fastify decorators (server) or class instances (daemon).
6. **No meaningless abstraction** — every extraction must make a specific file easier to work with. Don't add interfaces for the sake of it.
7. **Single definition for shared types** — types used across multiple files live in `src/shared/`. No duplicating type definitions.
8. **Plugins own their services** — Fastify plugins create and decorate their services. Routes consume decorated services, never instantiate them.
9. **Hooks are single-responsibility** — one hook per concern. Don't bundle data fetching + WebSocket subscriptions + business logic in one hook.
10. **Deprecated code gets removed** — don't leave deprecated modules running. Remove them promptly when superseded.

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here — not implementation details (code is the source of truth for those)
- Keep history focused on work, decisions focused on direction
