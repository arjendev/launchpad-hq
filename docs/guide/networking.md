# Networking & Environments

HQ auto-detects your environment and just works. This page is a quick reference for every setup.

## Quick Reference

| Setup | HQ binds to | Daemon connects to | Notes |
|-------|------------|-------------------|-------|
| **Windows / macOS / Linux (bare metal)** | `127.0.0.1` (default) | `ws://localhost:4321` | Everything on same machine |
| **WSL without devcontainers** | `127.0.0.1` (default) | `ws://localhost:4321` | Same Linux instance |
| **HQ in devcontainer, daemon in sibling container** | `0.0.0.0` (auto-detected) | `ws://<hq-container-name>:4321` | Docker bridge network |
| **HQ in devcontainer, daemon on bare WSL/host** | `0.0.0.0` (auto-detected) | `ws://localhost:4321` | VS Code port forwarding |
| **GitHub Codespaces** | `0.0.0.0` (auto-detected) | `ws://localhost:4321` | Same Codespace |
| **Remote access (phone/tablet)** | Any + `--tunnel` | Browser auto-uses `wss://` | Dev Tunnel provides HTTPS |

## How It Works

1. **Auto-detect** — HQ checks for Docker containers and GitHub Codespaces at startup
2. **Bind** — Inside a container → `0.0.0.0` (Docker network is isolated). Outside → `127.0.0.1` (localhost only)
3. **Connect** — Daemons connect outbound to HQ via WebSocket. The browser gets the correct URL automatically

Daemon↔HQ traffic is always plain `ws://` — it stays on the same machine or Docker bridge and is never exposed to the internet.

## CLI Flags

```bash
# Override the bind address
npx github:arjendev/launchpad-hq --host 0.0.0.0

# Change the port (works everywhere)
npx github:arjendev/launchpad-hq --port 4000

# Enable Dev Tunnel for remote access
npx github:arjendev/launchpad-hq --tunnel

# Or use environment variables
HOST=0.0.0.0 npx github:arjendev/launchpad-hq
```

| Flag / Env | Effect |
|-----------|--------|
| `--host <addr>` / `HOST` | Override the auto-detected bind address |
| `--port <number>` | Listen on a custom port (default: `3000`) |
| `--tunnel` | Start a Dev Tunnel for HTTPS remote access |

## Dev Tunnels

When you pass `--tunnel`, HQ creates a Microsoft Dev Tunnel that:

- Provides a public HTTPS URL for the dashboard
- Auto-upgrades the browser WebSocket to `wss://` (TLS at the tunnel endpoint)
- Requires no manual SSL setup

The daemon still connects over `ws://` locally — only the browser-facing side uses the tunnel.

## Troubleshooting

### `ECONNREFUSED` when connecting cross-container

**Symptom:** Daemon in one container can't reach HQ in another — connection refused on `localhost:4321`.

**Cause:** Containers have isolated network namespaces. `localhost` inside each container refers to itself, not the other container.

**Fix:**
1. Make sure HQ binds to `0.0.0.0` (auto-detected in devcontainers, or use `--host 0.0.0.0`)
2. Use the HQ container's hostname instead of `localhost`:
   ```json
   { "hqUrl": "ws://hq-container-name:4321/ws/daemon" }
   ```
3. Ensure both containers are on the same Docker network

### Port already in use

Change the port:

```bash
npx github:arjendev/launchpad-hq --port 4000
```

### Remote device can't connect

Use `--tunnel` to create a Dev Tunnel. The tunnel URL is shown in the terminal and as a QR code in the dashboard top bar.

## Next Steps

- [Daemon Setup](../daemon/setup) — Configure and run your daemon
- [Getting Started](./getting-started) — First-time setup walkthrough
- [DevTunnels](../features/devtunnels) — Remote access deep-dive
