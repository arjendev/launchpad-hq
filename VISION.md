# launchpad-hq

> A command and control center for anyone managing multiple projects living in many different repositories.

---

## The Idea

You're running multiple projects. They live in different repos, different devcontainers, different Copilot sessions. Some are humming along. Some need your attention right now. Some have been quietly stuck for days. You wouldn't know unless you went looking — and you have too many places to look.

**launchpad-hq** is the answer to that. One command, one dashboard, full visibility:

```
npx launchpad-hq
```

It gives you a UI to see the state of each project and its connected running devcontainers with their respective CLI sessions. From a high-level overview — open tasks, in progress, done, things requiring your attention — all the way down to each individual project's kanban board. From that high-level overview to deep-level introspection of the devcontainer, Copilot sessions, and the ability to attach to ongoing sessions to steer progress.

That's the whole pitch. **High-level overview to deep-level introspection.** Everything in between is just making that real.

---

## Progressive Depth

The core design principle is progressive depth. You start zoomed out and drill in as far as you need to go. Each level reveals more detail, more control.

```
  All Projects         →  "How's everything going?"
       │
  Single Project       →  "What's the status of this one?"
       │
  Kanban Board         →  "What's open, in progress, done?"
       │
  Devcontainer         →  "Is the environment running? What's happening inside?"
       │
  Copilot Session      →  "What has Copilot been working on? What's it stuck on?"
       │
  Session Takeover     →  "I'm taking the wheel."
```

You might check the dashboard from your phone on the train and see a yellow badge on a project. Later at your desk, you drill into that project's board, see a task is blocked, open the devcontainer session, read the Copilot conversation, inject a prompt to unstick it — or just attach to the terminal and fix it yourself.

That's the product. A command and control center that goes as deep as you need it to.

---

## The Dashboard

The UI is a three-pane mission control layout. Everything visible at a glance.

```
┌──────────────┬───────────────────────┬──────────────────┐
│              │                       │                  │
│  Projects    │    Kanban Board       │  Live Sessions   │
│              │                       │                  │
│  ● repo-a    │  ┌────┐ ┌────┐ ┌────┐│  ▶ devcontainer  │
│  ● repo-b    │  │TODO│ │ IP │ │DONE││  ▶ copilot chat  │
│  ◉ repo-c    │  │    │ │    │ │    ││  ▶ terminal /bin  │
│  ● repo-d    │  │ #12│ │ #8 │ │ #3 ││                  │
│              │  │ #15│ │#14 │ │ #7 ││  [Attach]        │
│              │  └────┘ └────┘ └────┘│                  │
│              │                       │                  │
└──────────────┴───────────────────────┴──────────────────┘
```

**Left panel:** Your projects. Each one shows badge counts — red for things that need you now, yellow for things that changed, green for all-clear. One glance tells you where to focus.

**Center panel:** The selected project's kanban board. Todo, in progress, done. GitHub Issues are the source of truth — launchpad reads them, caches them, enriches them with devcontainer and session context. Your issues stay GitHub-native; launchpad just gives you a better view.

**Right panel:** Live sessions for the selected project. Running devcontainers, active Copilot conversations, open terminals. This is where overview becomes introspection — you can read what's happening, and when you're ready, take over.

Light and dark themes, because you'll be staring at this.

---

## How It Works

### Projects

A project is a GitHub repo. That's the base unit. You add them explicitly — pick from your own repos or paste any git URL. Launchpad doesn't guess; you tell it what you're tracking.

If a project has a devcontainer, that's an enrichment layer. Launchpad discovers running devcontainers using the **Dev Container CLI** (`@devcontainers/cli`), spec-compliant. If there's a devcontainer.json, launchpad knows about it.

### Tasks

**GitHub Issues are the source of truth.** Launchpad fetches them via the GitHub GraphQL API — fast enough to pull issues across 10+ repos in a single request (~500ms). It caches them locally and enriches them with metadata: which devcontainer is running, which Copilot session is active, what needs attention.

The kanban board is a view on top of this. Todo, in progress, done. The issues stay in GitHub where they belong. Launchpad is the lens, not the ledger.

### Devcontainer Introspection

Launchpad talks to your devcontainers through the **Dev Container CLI**. It discovers what's running on your machine, reads their configuration and status, and pipes that into the dashboard in real time.

When a devcontainer starts, stops, or changes state, the dashboard knows. That status feeds into the attention badges — if a container you depend on goes down, you see red.

### Copilot Integration

This is where it gets interesting. Using the **GitHub Copilot SDK**, launchpad can query active Copilot sessions, read conversation state, and inject prompts. Not just passively watching — actively steering.

You're reviewing your projects from the dashboard. You see a Copilot session that's been spinning on the wrong approach. You read the conversation, understand the context, inject a better prompt, and move on. Or you see a session that finished and left a question for you. You answer it from the dashboard without ever opening the repo.

### Session Takeover

When reading isn't enough, you take over. **xterm.js** gives you a full terminal in the browser — attach to any session and operate as if you're sitting in front of it. Full bidirectional control, real keystrokes, real output.

This is the deepest level of introspection: you're not just observing the session, you're inside it.

### Phone Access

The same dashboard, from your phone. **Microsoft Dev Tunnels** bridges your local server to a URL you can open anywhere. No hosted service, no app to install — just your local launchpad, tunneled to your pocket.

Check badge counts on the bus. Review a kanban board over coffee. Spot a stuck session and inject a prompt from your couch.

---

## Architecture

Everything runs locally on your machine. No cloud services to manage. No infrastructure to pay for.

```
┌──────────────────────────────────────────────────────────┐
│                     Your Machine                         │
│                                                          │
│   ┌─────────────┐         ┌───────────────────────────┐  │
│   │   Fastify    │◄───────►│   React Dashboard         │  │
│   │   Server     │  HTTP   │   (Vite + Mantine)        │  │
│   │              │         └───────────────────────────┘  │
│   │  ┌─────────┐ │                                       │
│   │  │WebSocket│ │◄──── @devcontainers/cli (containers)  │
│   │  │  (ws)   │ │◄──── GitHub Copilot SDK (sessions)    │
│   │  │         │ │◄──── xterm.js streams (terminals)     │
│   │  └─────────┘ │                                       │
│   └──────┬───────┘                                       │
│          │                                               │
│          ├──── gh auth token (authentication)            │
│          ├──── GitHub GraphQL API (issues, repos)        │
│          └──── launchpad-state repo (persistence)        │
│                                                          │
└──────────┼───────────────────────────────────────────────┘
           │
           ▼ (optional)
      Dev Tunnels ───► Phone / Tablet / Anywhere
```

**Why local?** Your desktop has direct access to Docker, devcontainers, and Copilot processes. A local server means zero latency for introspection and full control without proxy layers. The dashboard connects to your running environment, not to a cloud replica of it.

**Three data flows converge in the UI:**

1. **GitHub API → polling** — TanStack Query fetches and caches issues, repo metadata, and state. Polling-based with smart cache invalidation.
2. **Devcontainers → push** — The server monitors container state via Dev Container CLI and pushes changes to the client over WebSocket. Real-time.
3. **Copilot SDK → push** — Session state and conversation data pushed to the client over WebSocket. Real-time.

Different refresh patterns — polling for GitHub data, push for live environment data — but they converge into one unified dashboard.

### State & Persistence

```
launchpad-hq (running locally)
    │
    ├──► Local cache (speed — enriched issues, session metadata)
    │
    └──► username/launchpad-state repo on GitHub (durability)
              │
              ├── Project configuration
              ├── Enrichment data
              └── Overarching issues that span repos
```

Each user gets their own `launchpad-state` GitHub repository. That's the persistence layer — no database. It's versioned, portable, and accessible from any device. The local cache is just for speed.

### Authentication

```
gh auth token  →  launchpad-hq reads the token  →  full GitHub API access
```

If you've got the `gh` CLI installed and authenticated, you're done. No OAuth flows, no token management, no secrets files. Launchpad reads your existing token and uses it. If it can't find one, it tells you how to set up.

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

### Backend

| Technology | Purpose |
|---|---|
| **Fastify** | HTTP server — modern, fast, plugin-based |
| **ws** | WebSocket — streams devcontainer and Copilot data to the UI |
| **@devcontainers/cli** | Container discovery and management — spec-compliant |
| **GitHub Copilot SDK** | Session introspection, conversation state, prompt injection |

### Infrastructure

| Technology | Purpose |
|---|---|
| **gh CLI** | Authentication via existing GitHub token |
| **GitHub GraphQL API** | Fast multi-repo data fetching |
| **Microsoft Dev Tunnels** | Phone/remote access without hosting |
| **GitHub repo** (`launchpad-state`) | All persistence — versioned, no database |

---

## Package Structure

Single package. One `npm install`. One `npx` command. No workspace hoisting, no linked packages.

```
launchpad-hq/
├── src/
│   ├── client/              # React + Vite frontend
│   │   ├── components/      # Panels, boards, badges, terminals
│   │   ├── hooks/           # TanStack Query hooks, WebSocket hooks
│   │   ├── routes/          # TanStack Router routes
│   │   └── theme/           # Mantine theme config (light/dark)
│   │
│   └── server/              # Fastify backend
│       ├── routes/          # REST API endpoints
│       ├── ws/              # WebSocket handlers
│       ├── github/          # GitHub API + GraphQL queries
│       ├── containers/      # Dev Container CLI integration
│       └── copilot/         # Copilot SDK integration
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
