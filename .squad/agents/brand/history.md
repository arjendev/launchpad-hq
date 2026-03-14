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

### 2026-03-14: ResizableTerminalPanel — inline panel replacing floating overlay
- **Component:** `src/client/components/ResizableTerminalPanel.tsx` — VS Code-style resizable bottom panel wrapping the existing `Terminal` component (or `CopilotConversation` for SDK/Squad sessions).
- **Drag handle:** 5px top divider with `row-resize` cursor. Pure mousedown/mousemove/mouseup — no library. Highlights with `--lp-accent` on hover.
- **Header bar:** Migrated from FloatingConversation patterns: session title/summary with tooltip, type badge (CLI/SDK/Squad with teal/blue/violet), status badge (active/idle/error/ended), Detach button (with disconnect call for CLI), End Session button with 3s confirm timeout.
- **Session routing:** `sessionType === "copilot-cli"` renders Terminal; all others render CopilotConversation. SDK/Squad sessions get a resume POST on mount.
- **Props:** `daemonId`, `terminalId?`, `sessionId`, `sessionType?`, `onClose?`, `defaultHeight?` (300px), `minHeight?` (100px).
- **Theme:** Uses `--lp-surface`, `--lp-border`, `--lp-text`, `--lp-accent` CSS variables. No custom CSS file needed — all inline styles using design tokens.
- **Test:** `tests/e2e/resizable-terminal-panel.spec.ts` — 3 Playwright tests (drag handle cursor, header buttons, confirm pattern). Guarded with count checks since panel only renders with active sessions.
- **Pattern:** Wraps Terminal.tsx without modification. All FloatingConversation header logic (status maps, confirm timer, detach disconnect, SDK resume) ported to inline panel context.

### 2026-03-14: SessionContext + SessionList — session selection layer

- **SessionContext** (`src/client/contexts/SessionContext.tsx`) — React context following ProjectContext pattern. Tracks `selectedSession: AggregatedSession | null` with `selectSession()` callback. On session switch: disconnects outgoing CLI sessions via `useDisconnectSession`, then resumes incoming session via `useResumeSession`. SDK/Squad sessions just clear selection (they keep running on daemon). Auto-clears selection when `selectedProject` changes.
- **SessionList** (`src/client/components/SessionList.tsx`) — narrow column component (~220px expected) showing all sessions for the selected project. Each item renders a status dot (green/yellow/red/gray), session type badge (CLI=teal, SDK=blue, Squad=violet), truncated summary, and relative time. Single-click toggles selection via `selectSession()`. "New" dropdown creates sessions (SDK/CLI/Squad). Uses same Mantine styling pattern as ProjectList (`var(--mantine-color-blue-light)` for selected state, `UnstyledButton` for click targets).
- **App.tsx** — `SessionProvider` added inside `ProjectProvider`, wrapping `RouterProvider`.
- **Test utils** — `SessionProvider` added to test provider wrapper.
- **8 new tests** (`SessionList.test.tsx`): no-project empty state, renders session items, shows type badges, empty session state, click selects, click deselects, New button present, heading visible.
- **Total tests passing:** 752 (744 existing + 8 new).
- **Helpers reused:** `timeAgo`, `sessionStatusColor`, `sessionTypeColor`, `sessionTypeLabel` from ConnectedProjectPanel migrated as local copies (no shared utils module yet).

### Inbox count badges on ProjectList
- **What:** Added `useInboxCount(owner, repo)` hook to `hooks.ts` and a red `Badge` in `ProjectItem` showing unread inbox count next to the project name.
- **Hook:** TanStack Query with 30s refetch interval, calls `GET /api/projects/:owner/:repo/inbox/count`, returns `InboxCountResponse` (`{ unread: number }`). URL params are `encodeURIComponent`-wrapped. Only enabled when owner+repo are truthy.
- **Badge:** Mantine `Badge` with `size="xs"`, `color="red"`, `variant="filled"`. Conditionally rendered only when `unread > 0`. Positioned inline in the project name row, between the repo name and daemon status emoji.
- **Layout:** Zero structural changes to `ProjectItem`. Badge sits in the existing `<Group gap={6}>` row, Mantine flexbox handles spacing naturally.
- **Files changed:** `src/client/services/hooks.ts` (new hook + import), `src/client/components/ProjectList.tsx` (import + hook call + badge JSX).
- **Tests:** All 80 client tests passing. No regressions.

### 2026-03-14: Progressive-depth layout rewrite — DashboardLayout

- **Rewrite:** Completely replaced old 3-pane DashboardLayout (ProjectList | KanbanBoard | ConnectedProjectPanel) with new progressive-depth layout: ProjectList (250px) | SessionList (220px) | Main area (flex, split vertically).
- **Removed:** `ConnectedProjectPanel` and `FloatingConversation` imports/renders. Both are being phased out in favor of inline panels.
- **Main area logic:** Three states — (1) no project: "Select a project to get started" empty state, (2) project but no session: KanbanBoard at full height, (3) session selected: KanbanBoard on top + ResizableTerminalPanel on bottom.
- **Terminal props:** `daemonId` from `useDaemonForProject(projectId)`, `sessionId` and `sessionType` from `useSelectedSession()`, `terminalId` set to `sessionId` (AggregatedSession has no terminalId field).
- **No App.tsx change needed:** SessionProvider was already in place from the SessionContext work.
- **E2E test updated:** Renamed "three-pane layout renders" → "progressive-depth layout renders", updated assertions to check for Sessions column and new empty state text.
- **CSS:** Pure flexbox, `--lp-border` for dividers, responsive column→row via `useMediaQuery`.
- **Build:** Vite build passes. Pre-existing type errors in FloatingConversation.tsx and ResizableTerminalPanel.tsx (unrelated `setTimeout` typing) still present but not caused by this change.

### InboxPanel Component

**Added:** `src/client/components/InboxPanel.tsx`, inbox hooks (`useInbox`, `useUpdateInboxMessage`) in `hooks.ts`, `"inbox"` channel in client `ws-types.ts`.

Key decisions:
- **Dual-query pattern:** `useInbox` fires two parallel TanStack queries (unread + read). Merged and sorted newest-first client-side. Archived messages hidden.
- **WS invalidation:** Subscribes to `"inbox"` channel; any WS message invalidates inbox + inbox-count caches for automatic re-fetch.
- **Session scoping:** Reads from `useSelectedSession` context. If session selected → filters by sessionId. Otherwise shows project-wide.
- **Unread indicator:** Bold title + blue left border + circle badge. Click marks read. Per-card archive icon.
- **Upgraded `useInboxCount`:** Added WS subscription to existing hook so badge counts also update in real-time.

### Kanban → BacklogList migration + component cleanup
- **Replaced KanbanBoard with BacklogList:** Flat sorted list (in-progress → todo → done) replaces 3-column kanban. Done items collapsed by default with "Show N completed" toggle. Each row shows status badge, title, issue number, assignee avatars. Click opens issue in GitHub.
- **Layout update:** DashboardLayout now shows InboxPanel (250px fixed) alongside BacklogList (flex: 1) in horizontal Flex split.
- **Deleted components:** FloatingConversation, ConnectedProjectPanel, TerminalOverlay — removed files + all imports + associated test files.
- **Test impact:** Removed ConnectedProjectPanel.test.tsx and TerminalOverlay.test.tsx. Updated App.test.tsx to test BacklogList instead of KanbanBoard/ConnectedProjectPanel. Updated CopilotConversation.test.tsx comment references. All 738 tests passing, build clean.

### 2026-03-14: Copilot SDK agent picker remembers per-project choice
- **Hooks/types:** Added `CopilotAgentCatalogResponse`, `CopilotAgentPreferenceResponse`, `useCopilotAgentCatalog(owner, repo)`, `useCopilotAgentPreference(owner, repo)`, and `useUpdateCopilotAgentPreference()` so discovered SDK agents and saved project choice stay separate.
- **UI pattern:** `SessionList` now shows a persistent `SDK: <choice>` badge beside the New button. The primary `Copilot SDK` action uses the remembered choice immediately, while alternate agent entries both switch the preference optimistically and create the session without waiting.
- **Payload:** `useCreateSession()` now forwards `agentId` only for Copilot SDK creates. `Default` remains the plain session path with no extra coordinator-facing flags in the UI.
- **Tests/validation:** Expanded `SessionList.test.tsx` for remembered choice display, remembered create, switching back to `Default`, and picking a discovered agent. Changed-file lint, targeted client tests, full `npm run test`, and `npm run build` all passed. Full `npm run typecheck` is still blocked by the unrelated `useRef()` error in `src/client/components/ResizableTerminalPanel.tsx`.

## Session: UI Redesign — Progressive Depth Navigation (2026-03-14)

**Delivered:** 7 agents across 11 tasks. ResizableTerminalPanel, SessionList + SessionContext, InboxPanel, progressive-depth DashboardLayout, BacklogList, component cleanup. Build passing, 738 tests green.

### Key work
1. **ResizableTerminalPanel (Brand-5):** Inline resize panel (no external lib) replaces FloatingConversation overlay. Drag handler, same header UX patterns, height defaults 300/100/85vh.
2. **SessionList + SessionContext (Brand-6):** New session browser column (220px). Disconnect-before-switch logic for CLI sessions; SDK/Squad sessions silent clear. Auto-resume on select.
3. **Inbox backend (Romilly-7):** Per-project persistence at `inbox/{owner}/{repo}.json` in launchpad-state. Fire-and-forget tool invocation wiring (request_human_review, report_blocker). Separate "inbox" WS channel. 3 REST routes + count endpoint.
4. **Progressive-depth layout (Brand-8):** 3-column grid (Projects 250px | Sessions 220px | Main flex). Main area: InboxPanel+BacklogList (top) | ResizableTerminalPanel (bottom). Removed ConnectedProjectPanel + FloatingConversation.
5. **InboxPanel (Brand-9):** Session-scoped inbox. Dual-query fetch (unread + read, merged). WS invalidation pattern. Upgraded useInboxCount for real-time badge updates.
6. **Inbox badges (Brand-10):** Red unread badge on ProjectItem. Updates in near-real-time via "inbox" WS channel.
7. **BacklogList + cleanup (Brand-11):** Flat sorted list (in-progress → todo → done collapsed). Deleted FloatingConversation, ConnectedProjectPanel, TerminalOverlay. All imports scrubbed. 738 tests passing.

### Decisions
- **ResizableTerminalPanel:** Inline panel, simple drag handler, same header patterns
- **SessionContext:** Disconnect-before-switch (CLI only), auto-resume, context-driven selection
- **Inbox backend:** Per-project files, fire-and-forget, dedicated WS channel, title fallback chain
- **Progressive-depth:** 3-column grid, ready for KanbanBoard → BacklogList swap
- **InboxPanel:** Dual-query, WS invalidation, session scoping via context, unread visual
- **BacklogList:** Flat list, done collapsed, click-to-GitHub, replaces kanban

### Files created (7)
- src/client/components/ResizableTerminalPanel.tsx
- src/client/components/SessionList.tsx
- src/client/components/InboxPanel.tsx
- src/client/components/BacklogList.tsx
- src/client/contexts/SessionContext.tsx
- src/server/routes/inbox.ts
- tests/e2e/resizable-terminal-panel.spec.ts

### Files deleted (3)
- src/client/components/FloatingConversation.tsx
- src/client/components/ConnectedProjectPanel.tsx
- src/client/components/TerminalOverlay.tsx

## Session: Dev Tunnels Integration Research (2026-03-14)

**Delivered:** Grooming + auth research for Issue #23 (Microsoft Dev Tunnels). Cooper handled grooming; TARS handled auth research. Architecture ready for P2 (pre-login) and P3+ (token-based QR code).

### Key findings for QR UI work
**From TARS Auth Research:**
- **Phase 1 (P2):** Temporary tunnel with pre-login (user runs `devtunnel user login` once beforehand)
- **Phase 2+ (P3):** Token-based auth for QR code — after tunnel creation, call `devtunnel token TUNNELID --expiration 4h` to generate short-lived bearer token. Embed in QR: `https://l3rs99qw-3000.usw2.devtunnels.ms?access_token=TOKEN`. Phone scans → opens URL with embedded token → devtunnel relay validates → launchpad session established.
- **Security model:** Token is short-lived (configurable 4h–30d), HTTPS-only, scoped to tunnel, auto-expires. Devtunnel relay handles validation automatically — no backend token storage needed.
- **QR code UI pattern:** After "Share" button click, show modal with QR code + expiration timer + "Copy URL" button.

### Decisions captured
1. Tunnel Lifecycle: Temporary (auto-delete on close) — simplest for P2, no state management needed
2. Authentication: Pre-login (user responsibility) — launchpad assumes user ran `devtunnel user login` beforehand. Clear error message if not authenticated.
3. URL Extraction: Regex parsing on stdout (devtunnel outputs text, not JSON)
4. Implementation Pattern: Adapt self-daemon spawner (proven subprocess lifecycle pattern)
5. Error Handling: Clear status codes (`running`, `not_running`, `not_available`, `auth_failed`, `error`)
6. CLI Integration: Simple `--tunnel` flag in CLI, set `TUNNEL_ENABLED` env var for server
7. Auth for QR Code (Phase 3+): Token-based with short expiration — instant mobile access, secure

### Files to change (P2)
- `src/cli.ts` — Parse --tunnel flag
- `src/server/config.ts` — Add tunnelEnabled field
- `src/server/tunnel.ts` — New: TunnelManager class
- `src/server/tunnel-plugin.ts` — New: Fastify plugin
- `src/server/routes/tunnel.ts` — New: GET /api/tunnel route
- `src/server/index.ts` — Register tunnel-plugin
- `README.md` — Document devtunnel CLI install requirement

### Files for QR UI (P3+)
- `src/client/components/ShareModal.tsx` — New modal showing QR code + expiration + copy URL
- `src/client/hooks/useDevTunnelShare.ts` — Hook to fetch tunnel status + generate/manage tokens

### Context for Brand
The QR code feature is a Phase 3+ enhancement. Pre-work (P2 temporary tunnel) is being handled by Cooper + TARS. Once P2 is complete, Brand will own the "Share" button UI, QR modal design, and token expiration timer component. The backend token generation is handled server-side; Brand's role is display + UX.

