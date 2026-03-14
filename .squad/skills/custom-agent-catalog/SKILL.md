# Custom Agent Catalog Discovery

## When to Use
- A daemon or local bridge needs to surface `.github/agents/*.agent.md` files to another service or UI.
- You need a default plain session option alongside discovered custom agents.
- The SDK already supports native custom-agent registration and runtime selection.

## Pattern
1. Discover agent files at startup from `.github/agents/`.
2. Parse each file into two artifacts:
   - A stable catalog entry for the UI/HQ (`id`, `name`, `displayName`, `description`, metadata)
   - An SDK runtime definition (`customAgents`) that keeps the markdown body as the prompt
3. Namespace persisted catalog IDs by source (`builtin:*`, `github:*`) instead of storing raw SDK names.
4. Always include a builtin default entry so the "plain session" path remains selectable.
5. Inject the discovered `customAgents` into every `createSession()` / `resumeSession()` call.
6. Activate the selected agent immediately after create/resume with `session.rpc.agent.select()`; use `deselect()` for the plain/default path.
7. Broadcast the catalog separately from registration if the UI needs live updates without reloading daemon metadata.

## Launchpad Notes
- Implementation lives in `src/daemon/copilot/agent-catalog.ts`, `src/daemon/copilot/manager.ts`, `src/daemon/index.ts`, and `src/shared/protocol.ts`.
- Launchpad persists selection as catalog `agentId`, not raw SDK `name`, so the default entry and file-backed agents share one stable selection model.
- `copilot-agent-catalog` is the daemon → HQ message for live catalog updates; `register.agentCatalog` is the durable snapshot attached to daemon metadata.

## Anti-Patterns
- Do not build a custom spawn/coordinator tool when the SDK already exposes `customAgents` and session agent RPCs.
- Do not omit the builtin default option — users need a way back to a plain session.
- Do not persist only the SDK name when multiple agent sources may exist later.
