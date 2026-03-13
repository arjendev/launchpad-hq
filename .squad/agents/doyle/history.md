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

### 2026-03-13: Phase 1 integration testing
- **Test count:** 138 total (122 existing + 16 new integration tests). All pass.
- **Integration test file:** `src/server/__tests__/integration.test.ts` — covers full CRUD lifecycle, GitHub data routes (overview, issues, dashboard), cache plugin routes, health endpoint, and cross-plugin co-registration.
- **Bug found:** Cache plugin (`src/server/cache/plugin.ts`) is NOT registered in `src/server/index.ts`. The module exists and works but isn't wired in — `GET /api/cache/stats` returns 404 on live server. Filed in decisions inbox.
- **Fix applied:** `tsconfig.client.json` was missing test exclusions (unlike server config), causing 11 typecheck errors. Added exclude patterns for `__tests__/`, `*.test.ts(x)`, `*.spec.ts(x)`.
- **Client rename verified:** Brand's `src/client/api/` → `src/client/services/` rename is clean. No stale imports found.
- **Live server testing:** All endpoints hit against real GitHub API confirmed working: auth, projects CRUD, overview, issues, dashboard, WebSocket. State persists to `launchpad-state` repo on startup.
- **Pattern:** Integration tests use `buildFullServer()` helper that registers all Phase 1 plugins (cache, health, projects, github-data) with mock state and GraphQL services.

## Phase 2 Summary

**Completed Work:** Phase 1 integration testing + Phase 2 validation
**Total Tests Added:** 16 new tests (Phase 2 validation)
**Commits:** 1 (integration tests and fixes)

Doyle's integration tests validated the entire Phase 1 foundation:
- All 122 existing Phase 1 tests still pass
- 16 new end-to-end integration tests cover the full stack
- Found and documented cache plugin wiring bug (fixed by Romilly immediately)
- Identified and fixed tsconfig.client.json test exclusion gap
- Verified Brand's API → services rename is clean
- Live server confirmed working against real GitHub API

The integration phase unlocked Phase 2 work with confidence. All infrastructure tested and working.


