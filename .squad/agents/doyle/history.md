## Core Context

**Project:** launchpad — npx command-center for managing projects, devcontainers, Copilot sessions with web/CLI UI.
**Stack:** Node.js, TypeScript, Fastify, React, Mantine, Vitest, Playwright, GitHub API.
**Owner:** Arjen

## Test Infrastructure Knowledge

### Vitest Setup
- **Workspace projects:** `vitest.config.ts` splits `server` (Node env) and `client` (jsdom + React plugin)
- **Mantine + jsdom:** Needs `window.matchMedia` polyfill in `src/test-utils/setup-dom.ts`
- **Auto-cleanup:** Manual afterEach `cleanup()` in client setup required — Testing Library's auto-cleanup unreliable with workspace projects
- **Test-utils split:** `src/test-utils/server.ts` and `src/test-utils/client.tsx` avoid cross-env dependencies
- **Patterns:** Server: `createTestServer()` + `server.inject()` for routes. Client: custom `render()` wraps in MantineProvider.
- **Coverage:** V8 provider, text + lcov reporters

### Test Findings (Phase 1–2)
- Cache plugin unwired in `src/server/index.ts` (fixed by Romilly)
- tsconfig.client.json lacked test exclusions (fixed)
- Copilot session lifecycle: All event transitions validated. Regression guard: projectId never "unknown"
- Onboarding e2e: Full wizard, config persistence, reset flow — all working
