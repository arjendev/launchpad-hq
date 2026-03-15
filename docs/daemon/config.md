# Daemon Configuration

Daemons are configured via `daemon.json` in the project root or through HQ settings.

## Configuration File

Create a `daemon.json` in your project root:

```json
{
  "hqUrl": "ws://localhost:3000/ws/daemon",
  "projectId": "owner/repo",
  "capabilities": {
    "copilot": true,
    "terminal": true,
    "git": true
  }
}
```

## Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `hqUrl` | `string` | `ws://localhost:3000/ws/daemon` | WebSocket URL of the HQ server |
| `projectId` | `string` | — | GitHub repository identifier (`owner/repo`) |
| `capabilities.copilot` | `boolean` | `true` | Enable Copilot SDK bridge |
| `capabilities.terminal` | `boolean` | `true` | Enable terminal PTY relay |
| `capabilities.git` | `boolean` | `true` | Enable git status reporting |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LAUNCHPAD_HQ_URL` | Override the HQ WebSocket URL |
| `LAUNCHPAD_PROJECT_ID` | Override the project identifier |

Environment variables take precedence over `daemon.json` values.

::: info
Configuration details may evolve as the daemon protocol matures. Check back for updates.
:::
