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

**Project lifecycle:** When a project is added, the user specifies the runtime target. Each project has lifecycle states: initialized (yes/no), daemon status (online/offline), work state (working/awaiting/stopped). Daemons are started explicitly, not auto-spawned.

**Daemon is the Copilot SDK bridge:** The daemon discovers local Copilot sessions via the SDK, relays conversation state and session status to HQ, and executes HQ commands (prompt injection, session attach) locally. HQ only aggregates. Defined 10 daemon responsibilities mapped to the real SDK: lifecycle manager, session discovery, session creation/resume, full event firehose, prompt injection, custom HQ-aware tools (`report_progress`, `request_human_review`, `report_blocker`), system message injection, project state (git status), terminal PTY (node-pty).

**Copilot SDK confirmed (2026-03-13):** `@github/copilot-sdk` exists in technical preview. Provides CopilotClient (JSON-RPC to CLI), session management, event streaming, session hooks, and custom tools. Daemon uses SDK directly. Adapter layer was deleted in favor of using SDK types as wire types (~400 lines removed).

**Single binary:** `launchpad-hq --daemon` starts daemon; `launchpad-hq` starts HQ server. Dynamic imports keep HQ deps out of daemon memory and vice versa.

**Dual-WebSocket:** HQ runs `/ws` for browser clients (channel-based pub/sub) and `/ws/daemon` for daemon connections (auth handshake + typed protocol). Protocol types in `src/shared/` with literal `type` discriminants.

---

## Work Phasing

> By Cooper. Updated 2026-03-14.

Phases 0–1 complete. Daemon architecture pivot re-scoped the backlog.

| Wave | Status | Issues |
|------|--------|--------|
| **Wave 1** | ✅ Done | WS protocol #36, theme #25, daemon core #30, daemon registry #34 |
| **Wave 2** | ✅ Done | project model #31, Copilot forwarding #29, self-registration #32, terminal relay #20, SDK integration #37, custom tools #38 |
| **Wave 3** | ✅ Done | Docker removal #33, xterm.js #19, conversation viewer #22, prompt injection #21, Dev Tunnels #23 |
| **Wave 4** | 📋 Next | attention badges #24, daemon health #35, error handling #26, e2e tests #27, API tests #28 |
| **Onboarding** | 📋 Groomed | #39–#45: local state, onboarding wizard, copilot/model/tunnel config steps |

### Onboarding Wizard (2026-03-15, Cooper)

7 issues (#39–#45) groomed. Key architectural decisions:
- **LaunchpadConfig layer:** `~/.launchpad/config.json` persists user choices (machine-local, distinct from ServerConfig and ProjectConfig)
- **Wizard intercepts in `src/cli.ts`** before server boot. Runs in terminal, collects choices, writes config.
- **LocalStateManager** needed as second `StateService` implementation for filesystem-only state.
- **Dependency graph:** #45 (tunnel crash fix) is independent. #39 + #40 parallel. #41–#44 after #40.

---

## Established Patterns

> These are implemented and the **code is the source of truth**. See `decisions-archive.md` for full details.

| Domain | Pattern | Key files |
|--------|---------|-----------|
| Build | ESM-only, TypeScript bundler moduleResolution, flat ESLint v9, Vite | `tsconfig.*.json`, `eslint.config.js`, `vite.config.ts` |
| Server | Fastify plugins (`FastifyPluginAsync`), centralized `loadConfig()` | `src/server/routes/`, `src/server/config.ts` |
| Client | Mantine AppShell, Flex layout, `useMediaQuery` responsive | `src/client/layouts/`, `src/client/components/` |
| Auth | `gh auth token` via `execFile`, Fastify plugin decorator | `src/shared/auth.ts` |
| Tests | Vitest workspace projects (server=Node, client=jsdom), split test-utils | `vitest.config.ts`, `src/test-utils/` |
| E2E | Playwright, Chromium only, `webServer` auto-start | `playwright.config.ts`, `tests/e2e/` |
| GitHub API | `graphql-request`, batched alias queries | `src/server/github/` |
| State | Three-layer: GitHubStateClient → LocalCache → StateManager | `src/server/state/` |
| WebSocket | `ws` + `noServer: true`, ConnectionManager, channel subscriptions | `src/server/ws/` |
| WS Client | WebSocketManager in React context, `useSubscription(channel)` | `src/client/hooks/`, `src/client/contexts/` |
| Attention | Rule engine, in-memory manager, SHA-256 deterministic IDs | `src/server/attention/` |
| Theme | ThemeContext wrapping Mantine, `--lp-*` CSS vars, dark default | `src/client/contexts/ThemeContext.tsx`, `src/client/styles/theme.css` |
| Tunnel | TunnelManager singleton wrapping `devtunnel` CLI, `fp` plugin pattern | `src/server/tunnel.ts`, `src/server/routes/tunnel.ts` |
| Tunnel UI | REST polling (5s via TanStack Query), not WebSocket | `src/client/components/TunnelButton.tsx` |
| Kanban | Client-side classification: CLOSED→Done, OPEN+assigned→In Progress, else→Todo | `src/client/components/BacklogList.tsx` |
| SDK sessions | Disconnect-before-resume pattern, CopilotManager dedup guards, tombstone-based resurrection prevention | `src/daemon/copilot/manager.ts`, `src/server/copilot-aggregator/` |
| Agent selection | SDK native `customAgents` + `session.rpc.agent.select()`, per-project preference via `defaultCopilotSdkAgent` | `src/daemon/copilot/manager.ts`, `src/server/routes/daemons.ts` |

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
