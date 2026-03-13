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

### Copilot Integration

This is where it gets interesting. The daemon uses **`@github/copilot-sdk`** (technical preview) to bridge Copilot and HQ. A `CopilotClient` connects to the Copilot CLI running locally, discovers sessions, creates new ones, and streams every event back to HQ as a full firehose. HQ filters before forwarding to the browser — the daemon sends everything, the server decides what the UI needs.

You're reviewing your projects from the dashboard. You see a Copilot session that's been spinning on the wrong approach. You read the conversation, understand the context, inject a better prompt, and move on. HQ sends the command to the daemon, the daemon executes it locally via the SDK. Or you see a session that finished and left a question for you. You answer it from the dashboard without ever opening the repo.

Custom tools registered on each session make agents **HQ-aware** — they can report progress, request human review, and signal blockers without being explicitly told to. System message injection gives every agent context about the launchpad project automatically.

HQ only aggregates — it never talks to the SDK directly. The daemon owns the SDK connection entirely.

### Session Takeover

When reading isn't enough, you take over. The daemon spawns a **PTY** locally (it's already inside the project environment) and HQ relays terminal I/O between the browser and the daemon. **xterm.js** in the browser gives you a full terminal — attach to any session and operate as if you're sitting in front of it. Full bidirectional control, real keystrokes, real output.

No `docker exec` needed. The daemon is already there.

This is the deepest level of introspection: you're not just observing the session, you're inside it.

### Daemon Responsibilities

The daemon is the workhorse. It owns the Copilot SDK connection, manages sessions, streams events, and gives HQ everything it needs to present a live picture of the project. Here's what it does:

**1. SDK Lifecycle Manager**
- Spawns `CopilotClient({ cliPath: "copilot" })` on daemon start
- Manages client lifecycle — start, stop, error recovery with `autoRestart: true`
- Reports SDK connection state to HQ: `disconnected → connecting → connected → error`
- Requires Copilot CLI installed and in PATH

**2. Session Discovery & Monitoring**
- On startup: `client.listSessions()` → reports all existing sessions to HQ
- Periodic polling picks up sessions created externally (e.g. from VS Code)
- `client.getLastSessionId()` provides quick resume hints

**3. Session Creation (from HQ)**
- HQ sends "create session" → daemon calls `client.createSession({ model, tools, systemMessage })`
- HQ can specify model, system message (append mode), and which custom tools to attach
- Streaming always enabled for real-time relay

**4. Session Resume/Attach (from HQ)**
- HQ sends "resume session" → daemon calls `client.resumeSession(id, { tools })`
- Reattaches event listeners for streaming to HQ

**5. Full Event Firehose**
- Every session gets `session.on()` listeners that stream ALL events to HQ:
  - `assistant.message.delta` / `assistant.message` — conversation
  - `assistant.reasoning.delta` / `assistant.reasoning` — thinking
  - `tool.executionStart` / `tool.executionComplete` — tool activity
  - `session.idle` / `session.error` / `session.start` — lifecycle
- HQ server filters before forwarding to browser clients

**6. Prompt Injection (from HQ)**
- HQ sends prompt → daemon calls `session.send({ prompt, attachments? })`
- Supports file attachments from the project directory
- Supports `session.abort()` from HQ to cancel runaway operations

**7. Custom HQ-Aware Tools**
- Registered on session creation via `defineTool()`:
  - `report_progress` — agent reports task status → relayed to HQ dashboard
  - `request_human_review` — agent requests human attention → creates attention item in HQ
  - `report_blocker` — agent signals it's blocked → HQ shows "needs attention" badge
- Tool handlers send messages back to HQ via WebSocket

**8. System Message Injection**
- Daemon appends context to every session's system message (append mode, preserves guardrails):
  *"You are working on project X in the launchpad-hq system. Use report_progress, request_human_review, and report_blocker tools to communicate with the human operator."*
- Makes agents automatically HQ-aware without user prompting

**9. Project State Reporter**
- Git status: branch, uncommitted changes, ahead/behind
- Periodically reports to HQ via `status-update` messages

**10. Terminal PTY (separate from Copilot)**
- Spawns local shell for manual access via `node-pty`
- Relays I/O to HQ for remote terminal in browser (xterm.js)

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
| **node-pty** | PTY spawning — terminal sessions inside the project environment |
| **GitHub Copilot SDK** | Local session discovery, conversation state, prompt injection |
| **@github/copilot-sdk** | Copilot CLI integration — session discovery, creation, events, prompt injection |

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
