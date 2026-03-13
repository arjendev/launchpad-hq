# Project Context

- **Owner:** Arjen
- **Project:** launchpad-hq — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, React + Vite + TanStack + Mantine, Fastify, WebSocket, GitHub Copilot SDK, xterm.js, Dev Container CLI, Dev Tunnels
- **Created:** 2026-03-13

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-13: Copilot SDK does not exist yet
No official `@github/copilot-sdk` or equivalent npm package is publicly available as of March 2026. Built the full introspection layer with an adapter pattern: `CopilotAdapter` interface with a `MockCopilotAdapter` for development. When the SDK ships, only the adapter implementation needs to change — the `CopilotSessionManager`, REST endpoints, and WebSocket integration remain stable.

### 2026-03-13: Module structure for copilot introspection
- `src/server/copilot/types.ts` — all data models (CopilotSession, ConversationMessage, SessionChangeEvent, CopilotAdapter interface)
- `src/server/copilot/mock-adapter.ts` — mock implementation with realistic session simulation
- `src/server/copilot/session-manager.ts` — orchestrator between adapter and Fastify plugin
- `src/server/copilot/plugin.ts` — Fastify plugin with REST routes + WebSocket broadcast
- Endpoints: `GET /api/copilot/sessions`, `GET /api/copilot/sessions/:id`
- WebSocket: broadcasts `SessionChangeEvent` on the `copilot` channel

### 2026-03-13: Parallel agent filesystem entanglement is real
When multiple squad agents work on the same branch/working tree, `git add` and `git commit` pick up each other's changes. Confirmed the decision doc entry from Brand. For future: consider explicit file-level staging (`git add <specific-files>`) and immediate commit, or feature branches per agent.

## Phase 2 Summary

**Completed Issues:** #15 (1/5 Phase 2 items)
**Total Tests Added (Phase 2):** 18 tests
**Commits:** 1 (copilot introspection)

CASE delivered the Copilot SDK introspection layer with a future-proof adapter pattern. The mock implementation powers frontend development today; the adapter interface makes SDK integration seamless when the official SDK ships. Decision captured in decisions.md.


