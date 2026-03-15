# Architecture

Launchpad HQ follows a **hub-and-spoke** model. HQ is the central dashboard (hub), and each project runs a daemon (spoke).

## High-Level Overview

```
┌─────────────┐       WebSocket        ┌──────────────┐
│  Browser UI  │◄──────────────────────►│  HQ Server   │
│  (React)     │    /ws (pub/sub)       │  (Fastify)   │
└─────────────┘                        └──────┬───────┘
                                              │
                                    /ws/daemon │ (typed protocol)
                                              │
                          ┌───────────────────┼───────────────────┐
                          │                   │                   │
                    ┌─────▼─────┐       ┌─────▼─────┐       ┌────▼──────┐
                    │  Daemon A  │       │  Daemon B  │       │  Daemon C  │
                    │ (project)  │       │ (project)  │       │ (project)  │
                    └───────────┘       └───────────┘       └───────────┘
```

## Components

### HQ Server

The Fastify server is the central hub. It:

- Serves the React frontend (Vite build)
- Provides REST API endpoints for projects, settings, and state
- Runs dual WebSocket servers:
  - `/ws` — Browser client pub/sub (channel-based)
  - `/ws/daemon` — Daemon connections (auth handshake + typed protocol)
- Aggregates data from all connected daemons
- Never reaches into daemons — daemons always connect outbound to HQ

### Daemons

Each project runs a daemon process (`launchpad-hq --daemon`). Daemons are responsible for:

- **Lifecycle management** — Project state reporting (initialized, online/offline, working/awaiting/stopped)
- **Copilot SDK bridge** — Discovers sessions, streams events, injects prompts, registers custom tools
- **Terminal PTY** — Provides terminal relay via `node-pty`
- **Git status** — Reports repository state back to HQ
- **Custom tools** — `report_progress`, `request_human_review`, `report_blocker`

### State Management

Three-layer state architecture:

1. **GitHubStateClient** — Reads/writes to the `launchpad-state` GitHub repo
2. **LocalCache** — Fast filesystem cache for frequently accessed data
3. **StateManager** — Orchestrates between GitHub and local layers

Alternatively, **LocalStateManager** provides filesystem-only state (no GitHub repo required).

## Single Binary

`launchpad-hq` is a single package. Dynamic imports keep HQ deps out of daemon memory and vice versa:

- `launchpad-hq` → starts HQ server
- `launchpad-hq --daemon` → starts daemon process

## Authentication

Uses `gh auth token` via `execFile` for GitHub authentication. Users must have the GitHub CLI installed and authenticated.
