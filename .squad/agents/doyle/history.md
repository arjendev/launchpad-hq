# Project Context

- **Owner:** Arjen
- **Project:** launchpad — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Potentially leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, npx CLI, Terminal/Web UI, GitHub API, Copilot SDK, Devcontainer API
- **Created:** 2026-03-13

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-13: Vitest test infrastructure established (#5)
- **Config:** `vitest.config.ts` uses workspace projects — `server` (Node env) and `client` (jsdom env with React plugin)
- **Mantine in jsdom:** Requires `window.matchMedia` polyfill in setup file (`src/test-utils/setup-dom.ts`). Without it, MantineProvider crashes on color scheme detection.
- **Auto-cleanup:** Testing Library's auto-cleanup doesn't work reliably with Vitest workspace projects. Client setup file imports `cleanup` from `@testing-library/react` in an `afterEach` hook via the custom `render` helper in `src/test-utils/client.tsx`.
- **Test-utils split:** Server helpers (`src/test-utils/server.ts`) and client helpers (`src/test-utils/client.tsx`) are kept separate to avoid cross-environment dependency issues (Fastify vs React/Mantine).
- **Custom render:** `src/test-utils/client.tsx` exports a `render` function that wraps components in `MantineProvider` automatically — tests import `render` from there, `screen` from `@testing-library/react`.
- **Server testing pattern:** Use `createTestServer()` + `server.register(plugin)` + `server.inject()` for route testing without starting a real HTTP listener.
- **Coverage:** V8 provider, text + lcov reporters, excludes test files, test-utils, config files, node_modules, dist.
