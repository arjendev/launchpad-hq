# Project Context

- **Owner:** Arjen
- **Project:** launchpad — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Potentially leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, npx CLI, Terminal/Web UI, GitHub API, Copilot SDK, Devcontainer API
- **Created:** 2026-03-13

## Core Context

**Phase 1 Foundation:** Brand delivered the complete frontend dashboard ecosystem. Issue #3 established Mantine v7 setup with TanStack Router. Issues #8 and #9 implemented project list panel (health badges, add/remove) and kanban board panel (three-column Todo/In Progress/Done with GitHub-native classification: CLOSED→Done, OPEN+assigned/label→In Progress, else→Todo). Read-only view keeps complexity manageable for Phase 1; drag-and-drop can layer on later. ProjectContext enables cross-pane data sharing without prop drilling. Both panels use TanStack Query for 30–60s polling intervals.

**Phase 2 Infrastructure:** Issue #16 rewrote SessionsPanel as three-section Mantine Accordion (Devcontainers, Copilot Sessions, Attention Items) with REST + WebSocket merge pattern (initial fetch + cache patch on updates). CopilotSessionCard uses lazy loading on expand. Attention dismiss calls POST /api/attention/:id/dismiss. Issue #17 built WebSocketManager with auto-reconnect/exponential backoff, ConnectionStatus badge, useSubscription hook. Fixed critical Copilot sessions API mismatch (unwrapped response shape). Playwright E2E setup (Chromium-only, webServer auto-start, 5 smoke tests). Issue #25: ThemeContext wraps Mantine's color scheme, CSS custom properties (--lp-*), no-flash script prevents FOUC, ThemeToggle component.

**Test Coverage:** 280 unit tests (Mantine components, React hooks, TanStack Query), 5 Playwright E2E smoke tests. All 351 integrated tests passing.

**Key Patterns:** 
- REST + WebSocket merge: fetch initial data, subscribe to channel, patch query cache on updates
- Component API sync: `src/client/services/types.ts` mirrors server types — keep in sync
- Mantine size props must be string (`"xs"`, `"sm"`), not numeric
- Mock pattern: `vi.stubGlobal("WebSocket", ...)` + `vi.unstubAllGlobals()`
- Selective git add avoids capturing other agents' uncommitted work in parallel sessions

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-13: Phase 2 Summary

**Completed Issues:** #16, #17 (2/5 Phase 2 items)  
**Total Tests Added (Phase 2):** 32 + 12 = 44 tests  
**Commits:** 2 (WebSocket client, live sessions panel)  

Brand delivered the complete client-side real-time layer:
1. **WebSocket client hooks** — auto-reconnect, exponential backoff, message queuing, context provider with typed subscriptions
2. **Live sessions panel** — three-accordion UI showing devcontainers, copilot sessions (with expandable conversation), and attention items. Real-time sync via WebSocket + TanStack Query.

All components integrate with the server's WebSocket broadcast channels (devcontainer, copilot, attention). The REST + WebSocket merge pattern (initial fetch + cache patching on updates) is clean and testable.

Decisions on WebSocket client architecture captured in decisions.md. Parallel filesystem entanglement issue resolved with selective `git add`.

### 2026-03-13: Renamed src/client/api/ → src/client/services/ for clarity
- The `api/` directory was renamed to `services/` to avoid confusion with server `/api` routes and proxy logic
- Updated all imports across the client codebase
- Vite proxy configuration stays unchanged (still routes `/api` to server)
- No functional changes; cleaner mental model for code organization

### 2026-03-13: Post-load runtime error fix — Copilot sessions API mismatch
- **Bug:** `useCopilotSessions()` hook used `fetchJson<CopilotSessionSummary[]>("/api/copilot/sessions")`, treating the API response as a raw array. The server actually returns `{ sessions: [...], count: N, adapter: "mock" }`. At runtime this caused `sessions.map is not a function` because `query.data ?? []` resolved to the wrapper object, not the array.
- **Fix:** Changed the `queryFn` to unwrap: `const res = await fetchJson<{ sessions: ..., count, adapter }>(...); return res.sessions;`
- **Test fix:** Updated `SessionsPanel.test.tsx` fetch mock for `/api/copilot/sessions` to return the correct `{ sessions, count, adapter }` shape instead of raw array.
- **Root cause:** Curl-based and unit test validation didn't catch this because tests mocked the wrong response shape and curl only checked HTTP status, not client-side consumption.

### 2026-03-13: Playwright E2E testing setup
- **@playwright/test** added as dev dependency with Chromium-only config for speed.
- **playwright.config.ts** at project root: `webServer` array starts both backend (PORT=3000 tsx) and frontend (vite :5173), `reuseExistingServer: true` for dev workflow.
- **tests/e2e/dashboard.spec.ts** — 5 smoke tests: no console errors on load, three-pane layout renders, no uncaught exceptions in 5s, API proxy works (/api/projects 200), WebSocket connects (ConnectionStatus shows "Live").
- **npm script:** `"test:e2e": "playwright test"` added to package.json.
- **Lesson:** Always run Playwright after frontend changes to catch real-browser issues that unit tests miss. The copilot sessions bug was invisible to vitest+jsdom but would crash in any real browser.

### 2026-03-13: Light/dark theme toggle (Issue #25)
- **ThemeContext** (`src/client/contexts/ThemeContext.tsx`) — thin wrapper around Mantine's `useMantineColorScheme()` and `useComputedColorScheme()` exposing `{ theme, toggleTheme, setTheme }`. Sets `data-theme` attribute on `<html>` in sync with Mantine's `data-mantine-color-scheme`.
- **CSS custom properties** (`src/client/styles/theme.css`) — `--lp-bg`, `--lp-surface`, `--lp-text`, `--lp-text-secondary`, `--lp-border`, `--lp-accent`, `--lp-success`, `--lp-warning`, `--lp-error`, `--lp-kanban-*` variables keyed off `[data-mantine-color-scheme]` selectors. Dark = deep navy mission control; Light = clean whites.
- **No-flash script** in `index.html` — inline `<script>` reads `mantine-color-scheme-value` from localStorage before React mounts and sets both `data-mantine-color-scheme` and `data-theme` attributes.
- **ThemeToggle** (`src/client/components/ThemeToggle.tsx`) — `ActionIcon` with sun/moon icons from `@tabler/icons-react`, placed in DashboardLayout header next to ConnectionStatus.
- **CSS transitions** — global 0.2s ease on `background-color`, `border-color`, `color`, `box-shadow` for smooth theme switching.
- **DashboardLayout** borders updated from `var(--mantine-color-default-border)` to `var(--lp-border)` for theme-aware pane dividers.
- **Test utils** updated to include `ThemeProvider` in the test wrapper.
- **6 new tests**: ThemeContext (provides value, toggle, setTheme, data-theme attribute) + ThemeToggle (renders, toggles on click). All 280 unit + 5 e2e tests passing.
- **Design decision**: Leveraged Mantine's built-in color scheme system rather than rolling a custom one. ThemeContext is a convenience wrapper — Mantine handles localStorage persistence and system preference detection (`defaultColorScheme="auto"`). This avoids duplicating logic and ensures all Mantine components adapt automatically.
- **Selective git add**: Used targeted staging to avoid committing other agents' files (TARS attention system was in working tree).

## Wave 1 Summary

**Phase 1 + Phase 2 Complete:** All Wave 1 issues closed (#25, #30, #34, #36)
**Total Tests Added (Wave 1):** 280 unit + 5 e2e tests
**Total Tests Passing:** 351 (integrated)

Wave 1 delivered complete frontend foundation: three-pane dashboard with project list, kanban board, and live sessions panel. Real-time WebSocket integration with devcontainers, Copilot sessions, and attention items. Light/dark theme toggle with Mantine integration. All components tested with vitest + Playwright E2E.
- **SessionsPanel** rewritten from placeholder to three-section Mantine `Accordion` (Devcontainers, Copilot Sessions, Attention Items), all default-expanded.
- **REST + WebSocket merge pattern**: `useDevcontainers()` and `useCopilotSessions()` hooks fetch initial data via TanStack Query, then patch the query cache on WebSocket updates using `qc.setQueryData()` inside a `useEffect` with a ref guard to avoid double-patching.
- **Client types** (`src/client/services/types.ts`) now mirrors server types for `DevContainer`, `CopilotSession`, `CopilotSessionSummary`, `AttentionItem`, `AttentionCountResponse` — keep in sync with `src/server/containers/types.ts`, `src/server/copilot/types.ts`, `src/server/attention/types.ts`.
- **Expandable conversation**: `CopilotSessionCard` uses `useState` toggle + lazy `useCopilotSession(id)` fetch on expand. Shows last 5 messages in a Mantine `Timeline`.
- **Attention dismiss**: `useDismissAttention()` mutation calls `POST /api/attention/:id/dismiss`, invalidates both `attention` and `attention-count` query keys.
- **Mantine size prop**: Must be string (`"xs"`, `"sm"`) not numeric — Mantine v7 types enforce this.
- **Test pattern for fetch mocks**: `vi.stubGlobal("fetch", vi.fn(...))` with URL matching handles multiple endpoints in one mock. Clean up with `vi.unstubAllGlobals()` in `beforeEach`.
- **Avoid staging other agents' work**: Use selective `git add` on specific files, not `git add -A`, when parallel agents share the filesystem.

### 2026-03-13: WebSocket client hooks & connection manager (Issue #17)
- **WebSocketManager** (`src/client/services/ws.ts`) — connection manager with auto-connect, auto-reconnect using exponential backoff (1s → 2s → 4s → max 30s), message queuing during disconnects, ping keep-alive (25s), and channel re-subscription on reconnect.
- **Client WS types** (`src/client/services/ws-types.ts`) — mirrors server protocol types: `Channel`, `ClientMessage`, `ServerMessage`, `ConnectionStatus`. Keep in sync with `src/server/ws/types.ts`.
- **WebSocketContext** (`src/client/contexts/WebSocketContext.tsx`) — React context provider with `useWebSocket()` hook (raw connection) and `useSubscription(channel)` hook (typed topic subscriptions with latest payload state).
- **ConnectionStatus** (`src/client/components/ConnectionStatus.tsx`) — Mantine Badge with dot variant showing Live/Connecting/Reconnecting/Offline. Added to DashboardLayout header.
- **App.tsx** — `WebSocketProvider` wraps the app (inside MantineProvider, outside ProjectProvider).
- **Test utils** — `src/test-utils/client.tsx` updated to include `WebSocketProvider` with dummy URL for all component tests.
- **Tests** — 18 unit tests for `WebSocketManager` (lifecycle, backoff, subscriptions, queuing, ping, listeners) + 6 tests for React context/hooks/component. All pass.
- **Parallel entanglement (again):** My files got swept into TARS's commit `ecd1f7c` (copilot #15) because we were working on the same filesystem. Same issue as #8/#9. Need separate branches or coordinated staging.
- **Mock pattern:** Use `vi.stubGlobal("WebSocket", ...)` + `vi.unstubAllGlobals()` — not direct assignment + `vi.restoreAllMocks()`, which clears mock implementations.

## Phase 2 Summary

**Completed Issues:** #16, #17 (2/5 Phase 2 items)
**Total Tests Added (Phase 2):** 32 + 12 = 44 tests
**Commits:** 2 (WebSocket client, live sessions panel)

Brand delivered the complete client-side real-time layer:
1. **WebSocket client hooks** — auto-reconnect, exponential backoff, message queuing, context provider with typed subscriptions
2. **Live sessions panel** — three-accordion UI showing devcontainers, copilot sessions (with expandable conversation), and attention items. Real-time sync via WebSocket + TanStack Query.

All components integrate with the server's WebSocket broadcast channels (devcontainer, copilot, attention). The REST + WebSocket merge pattern (initial fetch + cache patching on updates) is clean and testable.

Decisions on WebSocket client architecture captured in decisions.md. Parallel filesystem entanglement issue resolved with selective `git add`.

### 2026-03-13: Renamed src/client/api/ → src/client/services/ for clarity
- The `api/` directory was renamed to `services/` to avoid confusion with server `/api` routes and proxy logic
- Updated all imports across the client codebase
- Vite proxy configuration stays unchanged (still routes `/api` to server)
- No functional changes; cleaner mental model for code organization

### 2026-03-13: Post-load runtime error fix — Copilot sessions API mismatch
- **Bug:** `useCopilotSessions()` hook used `fetchJson<CopilotSessionSummary[]>("/api/copilot/sessions")`, treating the API response as a raw array. The server actually returns `{ sessions: [...], count: N, adapter: "mock" }`. At runtime this caused `sessions.map is not a function` because `query.data ?? []` resolved to the wrapper object, not the array.
- **Fix:** Changed the `queryFn` to unwrap: `const res = await fetchJson<{ sessions: ..., count, adapter }>(...); return res.sessions;`
- **Test fix:** Updated `SessionsPanel.test.tsx` fetch mock for `/api/copilot/sessions` to return the correct `{ sessions, count, adapter }` shape instead of raw array.
- **Root cause:** Curl-based and unit test validation didn't catch this because tests mocked the wrong response shape and curl only checked HTTP status, not client-side consumption.

### 2026-03-13: Playwright E2E testing setup
- **@playwright/test** added as dev dependency with Chromium-only config for speed.
- **playwright.config.ts** at project root: `webServer` array starts both backend (PORT=3000 tsx) and frontend (vite :5173), `reuseExistingServer: true` for dev workflow.
- **tests/e2e/dashboard.spec.ts** — 5 smoke tests: no console errors on load, three-pane layout renders, no uncaught exceptions in 5s, API proxy works (/api/projects 200), WebSocket connects (ConnectionStatus shows "Live").
- **npm script:** `"test:e2e": "playwright test"` added to package.json.
- **Lesson:** Always run Playwright after frontend changes to catch real-browser issues that unit tests miss. The copilot sessions bug was invisible to vitest+jsdom but would crash in any real browser.

## Phase 2 Summary

**Completed Issues:** #16, #17 (2/5 Phase 2 items)
**Total Tests Added (Phase 2):** 32 + 12 = 44 tests
**Commits:** 2 (WebSocket client, live sessions panel)

Brand delivered the complete client-side real-time layer:
1. **WebSocket client hooks** — auto-reconnect, exponential backoff, message queuing, context provider with typed subscriptions
2. **Live sessions panel** — three-accordion UI showing devcontainers, copilot sessions (with expandable conversation), and attention items. Real-time sync via WebSocket + TanStack Query.

All components integrate with the server's WebSocket broadcast channels (devcontainer, copilot, attention). The REST + WebSocket merge pattern (initial fetch + cache patching on updates) is clean and testable.

Decisions on WebSocket client architecture captured in decisions.md. Parallel filesystem entanglement issue resolved with selective `git add`.

### 2026-03-13: Renamed src/client/api/ → src/client/services/ for clarity
- The `api/` directory was renamed to `services/` to avoid confusion with server `/api` routes and proxy logic
- Updated all imports across the client codebase
- Vite proxy configuration stays unchanged (still routes `/api` to server)
- No functional changes; cleaner mental model for code organization

### 2026-03-13: Post-load runtime error fix — Copilot sessions API mismatch
- **Bug:** `useCopilotSessions()` hook used `fetchJson<CopilotSessionSummary[]>("/api/copilot/sessions")`, treating the API response as a raw array. The server actually returns `{ sessions: [...], count: N, adapter: "mock" }`. At runtime this caused `sessions.map is not a function` because `query.data ?? []` resolved to the wrapper object, not the array.
- **Fix:** Changed the `queryFn` to unwrap: `const res = await fetchJson<{ sessions: ..., count, adapter }>(...); return res.sessions;`
- **Test fix:** Updated `SessionsPanel.test.tsx` fetch mock for `/api/copilot/sessions` to return the correct `{ sessions, count, adapter }` shape instead of raw array.
- **Root cause:** Curl-based and unit test validation didn't catch this because tests mocked the wrong response shape and curl only checked HTTP status, not client-side consumption.

### 2026-03-13: Playwright E2E testing setup
- **@playwright/test** added as dev dependency with Chromium-only config for speed.
- **playwright.config.ts** at project root: `webServer` array starts both backend (PORT=3000 tsx) and frontend (vite :5173), `reuseExistingServer: true` for dev workflow.
- **tests/e2e/dashboard.spec.ts** — 5 smoke tests: no console errors on load, three-pane layout renders, no uncaught exceptions in 5s, API proxy works (/api/projects 200), WebSocket connects (ConnectionStatus shows "Live").
- **npm script:** `"test:e2e": "playwright test"` added to package.json.
- **Lesson:** Always run Playwright after frontend changes to catch real-browser issues that unit tests miss. The copilot sessions bug was invisible to vitest+jsdom but would crash in any real browser.

### 2026-03-13: Light/dark theme toggle (Issue #25)
- **ThemeContext** (`src/client/contexts/ThemeContext.tsx`) — thin wrapper around Mantine's `useMantineColorScheme()` and `useComputedColorScheme()` exposing `{ theme, toggleTheme, setTheme }`. Sets `data-theme` attribute on `<html>` in sync with Mantine's `data-mantine-color-scheme`.
- **CSS custom properties** (`src/client/styles/theme.css`) — `--lp-bg`, `--lp-surface`, `--lp-text`, `--lp-text-secondary`, `--lp-border`, `--lp-accent`, `--lp-success`, `--lp-warning`, `--lp-error`, `--lp-kanban-*` variables keyed off `[data-mantine-color-scheme]` selectors. Dark = deep navy mission control; Light = clean whites.
- **No-flash script** in `index.html` — inline `<script>` reads `mantine-color-scheme-value` from localStorage before React mounts and sets both `data-mantine-color-scheme` and `data-theme` attributes.
- **ThemeToggle** (`src/client/components/ThemeToggle.tsx`) — `ActionIcon` with sun/moon icons from `@tabler/icons-react`, placed in DashboardLayout header next to ConnectionStatus.
- **CSS transitions** — global 0.2s ease on `background-color`, `border-color`, `color`, `box-shadow` for smooth theme switching.
- **DashboardLayout** borders updated from `var(--mantine-color-default-border)` to `var(--lp-border)` for theme-aware pane dividers.
- **Test utils** updated to include `ThemeProvider` in the test wrapper.
- **6 new tests**: ThemeContext (provides value, toggle, setTheme, data-theme attribute) + ThemeToggle (renders, toggles on click). All 280 unit + 5 e2e tests passing.
- **Design decision**: Leveraged Mantine's built-in color scheme system rather than rolling a custom one. ThemeContext is a convenience wrapper — Mantine handles localStorage persistence and system preference detection (`defaultColorScheme="auto"`). This avoids duplicating logic and ensures all Mantine components adapt automatically.
- **Selective git add**: Used targeted staging to avoid committing other agents' files (TARS attention system was in working tree).

## Wave 1 Summary

**Phase 1 + Phase 2 Complete:** All Wave 1 issues closed (#25, #30, #34, #36)
**Total Tests Added (Wave 1):** 280 unit + 5 e2e tests
**Total Tests Passing:** 351 (integrated)

Wave 1 delivered complete frontend foundation: three-pane dashboard with project list, kanban board, and live sessions panel. Real-time WebSocket integration with devcontainers, Copilot sessions, and attention items. Light/dark theme toggle with Mantine integration. All components tested with vitest + Playwright E2E.


### 2026-03-14: Add Create Session UI — useCreateSession() hook & New Session button
- **What:** Added `useCreateSession()` mutation hook and "New Session" button to create Copilot sessions from the UI.
- **Hook details:** `useCreateSession(owner, repo)` calls `POST /api/daemons/:owner/:repo/copilot/sessions`, invalidates both `aggregated-sessions` and `copilot-sessions` query keys on success.
- **UI placement:** Button lives in `CopilotSessionsSection` above the session cards list, not as a separate section.
- **Daemon-gated:** Button disabled (greyed out) when daemon offline, matching existing Terminal button pattern. Tooltip explains why.
- **Refactored early-return pattern:** Old `CopilotSessionsSection` used early returns that would hide the button. Restructured to always render button first, then conditionally show loading/error/empty/list states below.
- **No model selector:** Task mentioned optional selector. Skipped it to keep UI clean — default model is fine, selector can layer on later if needed.
- **Files changed:** 3 files (hooks.ts, CopilotSessionsSection.tsx, ConnectedProjectPanel.tsx). 603 tests passing.
- **Decision captured in:** `.squad/decisions/decisions.md` — "Create Session UI — Button-first, no model selector"

### 2026-03-13: Session abort cache invalidation fix
- **Bug:** Sessions removed via abort were not disappearing from the UI because cache invalidation only cleared one of two related query keys.
- **Root cause:** `useAbortSession()` only invalidated `aggregated-sessions` query key, but some parts of the UI read from `copilot-sessions` query key (separate TanStack Query entry).
- **Fix:** Updated `useAbortSession()` to invalidate both cache keys after abort: `aggregated-sessions` and `copilot-sessions`.
- **Strategy:** Defensive caching — when in doubt about which cache keys a component might be using, invalidate all related keys. Better to re-fetch unnecessarily than leave stale data.
- **Testing:** Updated `useAbortSession` tests to verify both cache keys are invalidated on abort.
- **Integration:** Works seamlessly with Romilly's backend dual-path cleanup. Frontend cache invalidation (both keys) + backend removal (immediate + daemon safety net) = robust end-to-end abort workflow.
- **Commit:** 1e7c8f7
- **Decision captured in:** `.squad/decisions/decisions.md` — "Frontend — Session abort cache invalidation"
