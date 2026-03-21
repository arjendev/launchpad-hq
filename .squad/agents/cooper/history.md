## Core Context

**launchpad-hq** — Command & control center for multi-project management. Node.js + TypeScript + Fastify + Vite + GitHub API + Copilot SDK. Arjen (owner), dev ports: 3000 (server), 5173 (client), 9229 (debugger).

### Architecture Insights

- **Three data flows:** GitHub API (polling via TanStack Query), devcontainer/Docker (WebSocket push), Copilot SDK (multi-message conversation with context injection).
- **Config layers:** `LaunchpadConfig` (~/.launchpad/config.json) distinct from `ServerConfig` (runtime). Onboarding wizard populates LaunchpadConfig.
- **Copilot SDK:** Protocol v3, 19 public CopilotClient methods, first-class MCP support via `SessionConfig.mcpServers`. Low-risk MCP injection point: add `mcpServers` field to `SessionConfigWire`.
- **Security:** Jupyter-style URL token auth (server prints token at startup). Challenge-nonce daemon auth. Token generation uses `randomBytes`; validation uses `timingSafeEqual`.
- **Devcontainer:** CLI provides full lifecycle (up/down/exec/stop, JSON output); `dockerode` for health monitoring & events. Phase 1 local Docker; Phase 2 add remote Docker + openvscode-server; Phase 3 DevPod.

### Key Decisions (See .squad/decisions.md)

- **Phased roadmap:** Foundation → Core → Live → Deep → Polish (28 work items).
- **npx publishing:** Package needs `files` and `engines` fields; currently would ship 652 files (4.3 MB).
- **Context injection phases:** Phase 1 (MCP pass-through + instruction layering, 3-4 days); Phase 2 (HQ proxy tools, 1 week); Phase 3 (skill sharing, 1-2 weeks).
- **Devcontainer phases:** Phase 1 (local Docker CLI + dockerode); Phase 2 (remote Docker + openvscode-server); Phase 3 (DevPod or custom abstraction).
