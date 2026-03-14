---
name: "copilot-agent-preferences"
description: "Persist per-project Copilot SDK agent choices and merge them with live daemon catalogs"
domain: "server"
confidence: "high"
source: "Romilly implementation"
---

## Context

Use this pattern when HQ needs to remember a project-scoped Copilot SDK choice, but the live list of valid options comes from a connected daemon.

## Patterns

### Persisting the preference

- Store the project-level preference on `ProjectEntry` in `config.json` as `defaultCopilotSdkAgent`.
- Treat `null` as "use the default Copilot SDK agent".
- State helpers should distinguish:
  - `undefined` → project not found
  - `null` → project found, no custom agent selected
  - `string` → remembered custom agent name

### REST contract

- Expose a project-scoped `GET`/`PUT` route that returns both the remembered preference and the daemon-advertised catalog.
- Return the remembered preference even if the daemon is offline; use an empty catalog plus `daemonOnline: false`.
- Validate a requested preference against the live catalog when the daemon advertises one, but do not require daemon connectivity just to read stored state.

### Session creation fallback

- `POST /api/daemons/:owner/:repo/copilot/sessions` can accept an explicit `agent`.
- When the effective session type is `copilot-sdk` and no explicit `agent` was supplied, fall back to the remembered project preference.
- Only forward `config.agent` when the caller explicitly set it or a remembered non-null preference exists.

## Examples

```ts
const preferredAgent = await stateService.getProjectDefaultCopilotAgent(owner, repo);

const config: SessionConfigWire & { agent?: string | null } = {};
if (body.agent !== undefined) {
  config.agent = body.agent;
} else if (preferredAgent) {
  config.agent = preferredAgent;
}
```

## Anti-Patterns

- Requiring a connected daemon just to update the stored preference.
- Treating "project missing" and "default agent selected" as the same state.
- Always forwarding `agent: null` when nothing was selected; omit it unless the caller explicitly chose the default option.
