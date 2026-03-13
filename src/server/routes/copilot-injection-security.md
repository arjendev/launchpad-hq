# Copilot Prompt Injection — Security Considerations

## Overview

The prompt injection endpoints allow the HQ dashboard to send prompts into
active Copilot sessions running on connected daemons. This enables the
"conversation viewer" to inject follow-up prompts on behalf of the user.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/copilot/aggregated/sessions/:id/send` | Inject a prompt |
| `POST` | `/api/copilot/aggregated/sessions/:id/abort` | Abort a running turn |

## Threat model

### Current scope — single-user, local-only

Launchpad is a **single-user developer tool** that runs on `localhost`. The
HQ server binds to `127.0.0.1` by default, so only the local user can reach
these endpoints. There is no multi-user authentication layer and none is
needed in this context.

**Risk level: Low** — the person calling the endpoint is the same person
whose VS Code session will execute the prompt.

### Future: Dev Tunnels / remote access

When Dev Tunnels support is added (exposing HQ to the internet), these
endpoints **must** be gated behind additional authentication:

- A session token or bearer token issued at HQ startup.
- Or integration with the GitHub identity that owns the tunnel.
- Rate limiting should be considered to prevent abuse.

Until remote access is implemented, no additional auth is required.

## Design decisions

| Decision | Rationale |
|----------|-----------|
| No server-side confirmation dialog | Confirmation is the UI's responsibility — the dashboard should prompt before calling the endpoint. |
| No rate limiting | Single-user tool; rate limiting adds complexity with no benefit. Revisit when remote access is added. |
| 409 Conflict for active sessions | Prevents sending a new prompt while the session is already processing, avoiding message interleaving. |
| `source: 'hq-injection'` on messages | Allows the conversation viewer to visually distinguish HQ-injected prompts from VS Code user messages. |
| Prompt stored before daemon send | Ensures the conversation history is consistent even if the daemon send fails (the 502 error is returned but the prompt is recorded). |
