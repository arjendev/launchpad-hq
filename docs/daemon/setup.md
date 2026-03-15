# Daemon Setup

Each project in Launchpad HQ runs a daemon process that reports state back to the central HQ server.

## Starting a Daemon

Start a daemon for a project using the `--daemon` flag:

```bash
npx github:arjendev/launchpad-hq --daemon
```

Run this from within the project directory (or devcontainer).

## How It Works

The daemon:

1. Connects outbound to HQ via WebSocket (`/ws/daemon`)
2. Completes an auth handshake using `gh auth token`
3. Begins reporting project state, Copilot sessions, and terminal output
4. Listens for HQ commands (prompt injection, session attach, etc.)

HQ never reaches into daemons — all connections are initiated by the daemon.

## Runtime Targets

When adding a project, you specify how the daemon runs:

| Target | Description |
|--------|-------------|
| **WSL + Devcontainer** | Daemon runs inside the devcontainer |
| **WSL only** | Daemon runs in WSL without a devcontainer |
| **Local folder** | Daemon runs directly on the local filesystem |

## Daemon Lifecycle

Daemons are started **explicitly** — they are not auto-spawned by HQ.

| State | Meaning |
|-------|---------|
| Online | Connected and reporting to HQ |
| Offline | Not connected (stopped or unreachable) |

## Self-Registration

On first connection, the daemon self-registers with HQ, providing:

- Project repository information
- Runtime target details
- Available capabilities (Copilot SDK, terminal PTY, etc.)
