# WebSocket Protocol

Launchpad HQ uses a typed WebSocket protocol for daemon communication. All messages use literal `type` discriminants defined in `src/shared/`.

## Dual WebSocket Architecture

HQ runs two WebSocket servers:

| Endpoint | Purpose | Clients |
|----------|---------|---------|
| `/ws` | Browser pub/sub | React frontend |
| `/ws/daemon` | Daemon protocol | Project daemons |

## Connection Flow

```
Daemon                          HQ Server
  │                                │
  ├──── WebSocket Connect ────────►│
  │                                │
  │◄─── Auth Challenge ───────────┤
  │                                │
  ├──── Auth Response ────────────►│
  │     (gh auth token)            │
  │                                │
  │◄─── Auth Accepted ────────────┤
  │                                │
  ├──── Self-Registration ────────►│
  │                                │
  │◄──► Bidirectional Messages ───►│
  │                                │
```

## Message Types

All messages are JSON objects with a `type` field:

### Daemon → HQ

| Type | Description |
|------|-------------|
| `auth_response` | Authentication token |
| `register` | Daemon self-registration with capabilities |
| `project_state` | Git status, branch info |
| `copilot_sessions` | Active Copilot session list |
| `copilot_event` | Real-time Copilot session event |
| `terminal_output` | Terminal PTY data |
| `tool_result` | Custom tool execution result |

### HQ → Daemon

| Type | Description |
|------|-------------|
| `auth_challenge` | Request authentication |
| `auth_accepted` | Confirm successful auth |
| `prompt_inject` | Inject a prompt into a Copilot session |
| `session_attach` | Attach to a terminal session |
| `terminal_input` | Send input to a terminal |
| `tool_invoke` | Invoke a custom tool |

## Protocol Types

Protocol types are defined in `src/shared/` and shared between HQ and daemon code. Each message type uses TypeScript literal type discriminants for type-safe handling.

::: info
See `src/shared/` in the source code for the complete type definitions.
:::
