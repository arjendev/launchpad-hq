# REST API Reference

Launchpad HQ exposes a REST API via the Fastify server. All endpoints are prefixed with `/api`.

## Authentication

The server uses `gh auth token` for GitHub authentication. Ensure the GitHub CLI is installed and authenticated.

## Endpoints

### Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List all registered projects |
| `POST` | `/api/projects` | Add a new project |
| `DELETE` | `/api/projects/:id` | Remove a project |

### Copilot Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/copilot/sessions` | List active Copilot sessions |

Returns `{ sessions: [...], count: number, adapter: string }`.

### Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Get current settings |
| `PUT` | `/api/settings` | Update settings |

### Attention Items

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/attention` | List attention items |
| `POST` | `/api/attention/:id/dismiss` | Dismiss an attention item |

### Dev Tunnels

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tunnel/status` | Get tunnel status |

## Response Format

All endpoints return JSON. Error responses follow the format:

```json
{
  "error": "Error message",
  "statusCode": 400
}
```

## WebSocket

In addition to REST endpoints, real-time data is available via WebSocket:

- `/ws` — Browser client pub/sub (channels: `devcontainer`, `copilot`, `attention`)
- `/ws/daemon` — Daemon protocol connection

See [Protocol Reference](../daemon/protocol) for WebSocket details.

::: info
API endpoints may evolve as features are added. This reference covers the current stable surface.
:::
