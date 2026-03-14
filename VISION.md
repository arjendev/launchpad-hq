# launchpad-hq

> A command and control center for anyone managing multiple projects living in many different repositories.

---

## The Idea

You're running multiple projects. They live in different repos, different devcontainers, different Copilot sessions. Some are humming along. Some need your attention right now. Some have been quietly stuck for days. You wouldn't know unless you went looking — and you have too many places to look.

**launchpad-hq** is the answer to that. A hub-and-spoke dashboard where the hub gives you full visibility and each project runs a lightweight daemon that reports back. One package, two modes:

```
npx launchpad-hq          # starts the dashboard (hub)
launchpad --daemon         # starts a daemon in a project environment (spoke)
```

From a high-level overview — open tasks, in progress, done, things requiring your attention — all the way down to each individual project's kanban board. From that overview to deep-level introspection of the project environment, Copilot sessions, and the ability to attach to ongoing sessions to steer progress.

That's the whole pitch. **High-level overview to deep-level introspection.** Everything in between is just making that real.

---

## Progressive Depth

The core design principle is progressive depth. You start zoomed out and drill in as far as you need to go. Each level reveals more detail, more control. The daemon is the bridge — it runs inside the project's environment and relays everything back to HQ.

```
  All Projects         →  "How's everything going?"
       │
  Single Project       →  "What's the status of this one?"
       │
  Kanban Board         →  "What's open, in progress, done?"
       │
  Project Environment  →  "Is the daemon online? What's happening inside?"
       │                    (daemon relays environment state to HQ)
  Copilot Session      →  "What has Copilot been working on? What's it stuck on?"
       │                    (daemon discovers sessions via SDK locally)
  Session Takeover     →  "I'm taking the wheel."
                            (daemon spawns PTY, HQ relays I/O to browser)
```

You might check the dashboard from your phone on the train and see a yellow badge on a project. Later at your desk, you drill into that project's board, see a task is blocked, open the environment session, read the Copilot conversation, inject a prompt to unstick it — or just attach to the terminal and fix it yourself.

That's the product. A command and control center that goes as deep as you need it to.

---

## The Dashboard

The UI is a three-pane mission control layout. Everything visible at a glance.

```
┌──────────────┬───────────────────────┬──────────────────┐
│              │                       │                  │
│  Projects    │    Kanban Board       │  Live Sessions   │
│              │                       │                  │
│  ● repo-a    │  ┌────┐ ┌────┐ ┌────┐│  ▶ daemon online │
│  ● repo-b    │  │TODO│ │ IP │ │DONE││  ▶ copilot chat  │
│  ◉ repo-c    │  │    │ │    │ │    ││  ▶ terminal /bin  │
│  ● repo-d    │  │ #12│ │ #8 │ │ #3 ││                  │
│              │  │ #15│ │#14 │ │ #7 ││  [Attach]        │
│              │  └────┘ └────┘ └────┘│                  │
│              │                       │                  │
└──────────────┴───────────────────────┴──────────────────┘
```

**Left panel:** Your projects. Each one shows badge counts — red for things that need you now, yellow for things that changed, green for all-clear. One glance tells you where to focus.

**Center panel:** The selected project's kanban board. Todo, in progress, done. GitHub Issues are the source of truth — launchpad reads them, caches them, enriches them with environment and session context. Your issues stay GitHub-native; launchpad just gives you a better view.

**Right panel:** Live sessions for the selected project. Connected daemons, active Copilot conversations, open terminals. This is where overview becomes introspection — you can read what's happening, and when you're ready, take over.

Light and dark themes, because you'll be staring at this.

---

## How It Works

### Projects

A project is a GitHub repo. That's the base unit. You add them explicitly — pick from your own repos or paste any git URL. Launchpad doesn't guess; you tell it what you're tracking.

When you add a project, you specify **how and where** it runs:

| Runtime target | What it means |
|---|---|
| **WSL + devcontainer** | Project runs in a devcontainer inside WSL |
| **WSL only** | Project runs directly in WSL, no container |
| **Local folder** | Project runs on the host machine |

Each project has lifecycle states that the dashboard tracks:

| State | Values |
|---|---|
| **Initialized** | yes / no — has the project been set up? |
| **Daemon** | online / offline — is the daemon connected to HQ? |
| **Work state** | working / awaiting / stopped — what's the project doing? |

HQ generates a shared secret token for each project's daemon. The daemon uses this token to authenticate when it connects.

### Tasks

**GitHub Issues are the source of truth.** Launchpad fetches them via the GitHub GraphQL API — fast enough to pull issues across 10+ repos in a single request (~500ms). It caches them locally and enriches them with metadata: daemon status, active Copilot sessions, what needs attention.

The kanban board is a view on top of this. Todo, in progress, done. The issues stay in GitHub where they belong. Launchpad is the lens, not the ledger.

### Environment Introspection

Launchpad knows about project environments because **daemons register with HQ** — that's how HQ discovers what's running. No polling Docker, no scanning containers. Each daemon connects outbound to HQ over WebSocket and reports its environment state.

When a daemon comes online, goes offline, or reports a state change, the dashboard knows instantly. That status feeds into the attention badges — if an environment you depend on goes down, you see red.

### Copilot Integration — Three Variants

Launchpad supports three distinct Copilot integration modes. Each serves a different use case, but all share the same session model — they appear in a unified session list with a type badge, and the user can create, resume, and close any of them from the same UI. The integration type is configured per-project (default) with per-session override.

#### Variant 1: `copilot-cli` — Terminal Sessions

The simplest integration. The daemon spawns the **`copilot`** CLI binary in a PTY terminal. The user interacts through a full **xterm.js** terminal widget in the floating overlay — real keystrokes, real output, full bidirectional control.

A copilot-cli session *is* an active terminal process. The key design: the user can **close the UI window** without killing the terminal. The process keeps running in the daemon. When they want to come back, they resume the session from the modal and the terminal reattaches — output buffered while detached is replayed.

This maps directly to how developers already use `copilot` in their terminal, but now it's accessible from HQ across all projects simultaneously.

#### Variant 2: `copilot-sdk` — Programmatic Sessions + Multi-Agent Coordinator

The current approach, extended. The daemon uses **`@github/copilot-sdk`** (`CopilotClient`) to create sessions programmatically. A session has a model, system message, custom tools, streaming events — the full SDK surface.

What's new: **multi-agent coordination.** The daemon runs an orchestrator session that can spawn sub-agent sessions as tools. Each `CopilotSession` is an autonomous agent with its own model, tools, system prompt, and context. The orchestrator decides when to delegate, spawns the right specialist, collects results, and continues.

```
Orchestrator Session (daemon)
    ├── tool: review_code → spawns Code Review sub-session
    ├── tool: write_tests → spawns Test Writer sub-session
    └── tool: analyze_perf → spawns Performance sub-session
```

The coordinator lives **entirely in the daemon** — HQ just relays. Sub-agent events stream to HQ as-is, tagged with the parent orchestrator session. The UI shows the full multi-agent tree: which sub-agents were spawned, what they're doing, how their results flow back.

Hooks (`onPreToolUse`, `onPostToolUse`, `onUserInputRequest`, `onErrorOccurred`) give fine-grained control over the agent loop. Permission decisions can be forwarded to HQ for human approval instead of auto-approving everything.

#### Variant 3: `squad-sdk` — Full Multi-Agent Framework

The heavyweight option. **`@bradygaster/squad-sdk`** wraps the Copilot SDK and provides a complete multi-agent coordination framework out of the box:

- **CastingEngine** — assigns the right agent to each task based on role definitions
- **Router** — analyzes messages and determines which agents should handle them
- **HookPipeline** — pre/post processing on every agent interaction
- **EventBus** — structured event flow across all agents
- **spawnParallel** — fan-out to multiple agents simultaneously with result collection
- **Persistent sessions** — crash recovery, session resumption across restarts

The daemon integrates with `SquadCoordinator` — the central orchestrator that handles the full pipeline: direct response check → route analysis → spawn strategy (direct/single/multi/fallback) → fan-out → collect results → emit events.

Squad sessions appear in the same unified session list. The difference is under the hood: squad-sdk manages the agent topology, and the daemon bridges its EventBus to HQ's WebSocket relay.

#### Unified Session Model

All three variants produce sessions that share a common shape:

| Field | Description |
|---|---|
| `sessionId` | Unique identifier |
| `sessionType` | `copilot-cli` \| `copilot-sdk` \| `squad-sdk` |
| `status` | `idle` \| `active` \| `error` \| `ended` |
| `summary` | Human-readable session summary |
| `startedAt` / `updatedAt` | Timestamps |

The resume modal shows all sessions together with a type badge. The floating overlay adapts its rendering based on type: terminal widget for `copilot-cli`, chat view for `copilot-sdk` and `squad-sdk`.

HQ only aggregates — it never talks to any SDK directly. The daemon owns all SDK connections entirely.

### Daemon Responsibilities

The daemon is the workhorse. It owns all Copilot integrations, manages sessions across all three variants, streams events, and gives HQ everything it needs to present a live picture of the project.

**1. Integration Manager**
- Manages all three integration backends: CLI terminal, Copilot SDK, Squad SDK
- Per-project default integration type, overridable per-session
- Reports backend availability to HQ (which integrations are installed and functional)
- Graceful degradation — if squad-sdk isn't installed, only cli and sdk variants are available

**2. Copilot SDK Lifecycle**
- Spawns `CopilotClient({ cwd })` on daemon start
- Manages client lifecycle — start, stop, error recovery with `autoRestart: true`
- Reports SDK connection state to HQ: `disconnected → connecting → connected → error`
- Shared across both `copilot-sdk` and `squad-sdk` variants (squad wraps the same client)

**3. Session Discovery & Monitoring**
- On startup: `client.listSessions()` → reports all existing sessions to HQ
- Periodic polling picks up sessions created externally (e.g. from VS Code)
- Terminal sessions tracked separately via PTY process table

**4. copilot-cli Session Management**
- Spawns `copilot` binary in a PTY via `node-pty`
- Tracks PTY as a session in the unified session list
- Buffers terminal output while UI is detached
- Reattaches on resume — replays buffered output, resumes live relay
- Kills PTY on session end

**5. copilot-sdk Session Management**
- Creates/resumes sessions via `client.createSession()` / `client.resumeSession()`
- Wires event listeners for full firehose streaming to HQ
- Multi-agent coordinator: orchestrator session with sub-agent sessions as tools
- Sub-agent lifecycle managed by daemon — spawn, collect results, clean up

**6. squad-sdk Session Management**
- Creates `SquadCoordinator` with project-specific agent definitions
- Bridges squad EventBus events to HQ WebSocket relay
- Exposes squad tools (`squad_route`, `squad_decide`, `squad_memory`) through HQ
- Agent casting and routing handled by squad-sdk internals

**7. Full Event Firehose**
- Every session (all variants) streams ALL events to HQ:
  - SDK events: `assistant.message_delta`, `tool.execution_start`, `session.idle`, etc.
  - Terminal events: output data, resize, exit
  - Squad events: agent spawned, route decision, fan-out started, results collected
- Events flow as-is — no mapping, no renaming. HQ forwards to browser.

**8. Custom HQ-Aware Tools**
- Registered on every SDK/Squad session via `defineTool()`:
  - `report_progress` — agent reports task status → relayed to HQ dashboard
  - `request_human_review` — agent requests human attention → creates attention item
  - `report_blocker` — agent signals it's blocked → HQ shows "needs attention" badge
- Tool handlers send messages back to HQ via WebSocket

**9. System Message Injection**
- Daemon appends context to every SDK/Squad session's system message (append mode):
  *"You are working on project X in the launchpad-hq system. Use report_progress, request_human_review, and report_blocker tools to communicate with the human operator."*
- Makes agents automatically HQ-aware without user prompting

**10. Project State Reporter**
- Git status: branch, uncommitted changes, ahead/behind
- Periodically reports to HQ via `status-update` messages

### Phone Access

The same dashboard, from your phone. **Microsoft Dev Tunnels** bridges your local server to a URL you can open anywhere. No hosted service, no app to install — just your local launchpad, tunneled to your pocket.

Check badge counts on the bus. Review a kanban board over coffee. Spot a stuck session and inject a prompt from your couch.

In the future, the same daemon model enables remote support — daemons on Codespaces or remote machines connect to HQ via a tunnel URL. Same architecture, longer wire.

---

## Architecture

Hub-and-spoke. HQ is the hub. Daemons are the spokes. Daemons always connect outbound to HQ — HQ never reaches into them.

```
                        ┌─────────────┐
                        │   Browser   │
                        └──────┬──────┘
                               │ ws + HTTP
                               ▼
┌──────────────────────────────────────────────────────────┐
│                    launchpad-hq (hub)                     │
│                                                          │
│   ┌─────────────┐         ┌───────────────────────────┐  │
│   │   Fastify    │◄───────►│   React Dashboard         │  │
│   │   Server     │  HTTP   │   (Vite + Mantine)        │  │
│   │              │  + WS   └───────────────────────────┘  │
│   │  ┌─────────┐ │                                       │
│   │  │WebSocket│ │◄──── daemon connections (spokes)      │
│   │  │  (ws)   │ │◄──── xterm.js relay (terminal I/O)   │
│   │  └─────────┘ │                                       │
│   └──────┬───────┘                                       │
│          │                                               │
│          ├──── gh auth token (authentication)            │
│          ├──── GitHub GraphQL API (issues, repos)        │
│          └──── launchpad-state repo (persistence)        │
└──────────┼───────────────────────────────────────────────┘
           │
     ┌─────┴──────────────────────────────┐
     │              │                     │
     ▼              ▼                     ▼
┌──────────┐  ┌──────────┐         ┌──────────┐
│ daemon   │  │ daemon   │   ···   │ daemon   │
│ project-a│  │ project-b│         │ project-n│
│          │  │          │         │          │
│ Copilot  │  │ Copilot  │         │ Copilot  │
│ SDK      │  │ SDK      │         │ SDK      │
│ Squad SDK│  │ CLI PTY  │         │ Squad SDK│
│ node-pty │  │ node-pty │         │ node-pty │
└──────────┘  └──────────┘         └──────────┘
  (WSL/DC)     (WSL only)          (local/remote)
```

**Communication flow:**

```
Browser ←ws→ HQ Server ←ws→ Daemon(s)
```

The browser never talks to daemons directly. HQ is the single relay point. Daemons initiate all connections outbound — this preserves environment isolation (especially important for devcontainers).

**Why this model?** HQ has no access to what's inside a devcontainer or remote environment. The daemon is already there — it can discover Copilot sessions, spawn terminals, read environment state. It pushes everything to HQ. HQ aggregates and presents. Clean separation.

**Three data flows converge in the UI:**

1. **GitHub API → polling** — TanStack Query fetches and caches issues, repo metadata, and state. Polling-based with smart cache invalidation.
2. **Daemon state → push** — Daemons push environment status, Copilot session state, and terminal I/O to HQ over WebSocket. HQ relays to the browser. Real-time.
3. **Commands → push (reverse)** — HQ pushes commands (inject prompt, attach terminal, restart) down to daemons. Daemons execute locally.

Different refresh patterns — polling for GitHub data, push for live environment data — but they converge into one unified dashboard.

### State & Persistence

```
launchpad-hq (running locally)
    │
    ├──► Local cache (speed — enriched issues, session metadata)
    │
    └──► username/launchpad-state repo on GitHub (durability)
              │
              ├── Project configuration (incl. runtime targets)
              ├── Enrichment data
              └── Overarching issues that span repos
```

Each user gets their own `launchpad-state` GitHub repository. That's the persistence layer — no database. It's versioned, portable, and accessible from any device. The local cache is just for speed.

### Authentication

```
gh auth token  →  launchpad-hq reads the token  →  full GitHub API access
```

If you've got the `gh` CLI installed and authenticated, you're done. No OAuth flows, no token management, no secrets files. Launchpad reads your existing token and uses it. If it can't find one, it tells you how to set up.

Daemon authentication is separate — HQ generates a shared secret token per project. The daemon presents this token when connecting over WebSocket. No GitHub token needed on the daemon side.

---

## Tech Stack

### Frontend

| Technology | Purpose |
|---|---|
| **React** | UI framework — component model, ecosystem |
| **Vite** | Build tooling — fast HMR, modern defaults |
| **TanStack Query** | Server state — polling, caching, invalidation for GitHub API data |
| **TanStack Router** | Routing — type-safe, integrates with Query |
| **Mantine** | Component library — dashboard-ready, rich theming (light/dark) |
| **xterm.js** | Terminal emulation — full session takeover in the browser |

### Backend (HQ)

| Technology | Purpose |
|---|---|
| **Fastify** | HTTP server — modern, fast, plugin-based |
| **ws** | WebSocket — browser connections + daemon connections |
| **GitHub Copilot SDK** | Session data aggregation (via daemon relay) |

### Daemon

| Technology | Purpose |
|---|---|
| **ws** | WebSocket client — outbound connection to HQ |
| **node-pty** | PTY spawning — terminal sessions (copilot-cli + manual) |
| **@github/copilot-sdk** | Copilot integration — session lifecycle, events, multi-agent coordination |
| **@bradygaster/squad-sdk** | Multi-agent framework — routing, casting, EventBus, spawnParallel |

### Infrastructure

| Technology | Purpose |
|---|---|
| **gh CLI** | Authentication via existing GitHub token |
| **GitHub GraphQL API** | Fast multi-repo data fetching |
| **Microsoft Dev Tunnels** | Phone/remote access without hosting |
| **GitHub repo** (`launchpad-state`) | All persistence — versioned, no database |

---

## Package Structure

Single package. One `npm install`. One `npx` command. No workspace hoisting, no linked packages. CLI flags select the mode.

```
launchpad-hq/
├── src/
│   ├── client/              # React + Vite frontend
│   │   ├── components/      # Panels, boards, badges, terminals
│   │   ├── hooks/           # TanStack Query hooks, WebSocket hooks
│   │   ├── routes/          # TanStack Router routes
│   │   └── theme/           # Mantine theme config (light/dark)
│   │
│   ├── server/              # Fastify backend (HQ mode)
│   │   ├── routes/          # REST API endpoints
│   │   ├── ws/              # WebSocket handlers (browser + daemon)
│   │   ├── github/          # GitHub API + GraphQL queries
│   │   └── copilot/         # Copilot data aggregation (from daemons)
│   │
│   ├── daemon/              # Daemon mode
│   │   ├── connection/      # WebSocket client → HQ
│   │   ├── copilot/         # Copilot SDK adapter (local discovery)
│   │   ├── terminal/        # PTY management (node-pty)
│   │   └── env/             # Environment state reporting
│   │
│   └── shared/              # Shared types and protocols
│       ├── protocol.ts      # WebSocket message types (HQ ↔ daemon)
│       └── types.ts         # Shared domain types
│
├── package.json             # Single package, npx-ready
└── vite.config.ts
```

---

## Non-Goals

| What we're not building | Why |
|---|---|
| **Multi-user / team tool** | This is a personal command and control center. One user, one instance. |
| **Hosted service** | Runs on your machine. No servers to maintain, no bills to pay. |
| **Native mobile app** | Dev Tunnels + responsive web gets your phone covered. No App Store. |
| **CI/CD dashboard** | We show project status, not pipeline config. |
| **Code editor** | This is mission control, not an IDE. Your editor is your editor. |
| **Database** | GitHub is the persistence layer. No Postgres, no SQLite, no Redis. |

---

## The Name

`launchpad` was taken on npm. **launchpad-hq** keeps the brand and leans into the metaphor — this is headquarters. The place you go to see everything, decide what matters, and launch into action.

```
npx launchpad-hq
```

---

*From high-level overview to deep-level introspection. That's launchpad.*
