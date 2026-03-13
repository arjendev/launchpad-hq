# Project Context

- **Owner:** Arjen
- **Project:** launchpad — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Potentially leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, npx CLI, Terminal/Web UI, GitHub API, Copilot SDK, Devcontainer API
- **Created:** 2026-03-13

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-13: Client shell setup (Issue #3)
- **Mantine v7** requires `postcss`, `postcss-preset-mantine`, and `postcss-simple-vars` — added `postcss.config.cjs` at project root.
- `MantineProvider` wraps the app with `defaultColorScheme="auto"` for light/dark support.
- **TanStack Router**: `router.tsx` defines a root route with `Outlet` and an index route at `/` rendering `DashboardLayout`.
- **Three-pane layout** uses Mantine `AppShell` for the header + `Flex` for the panes. `ScrollArea` wraps each pane. Left=250px, Right=300px, Center=flex. On small screens (`max-width: 768px` via `useMediaQuery`), panes stack vertically.
- Component structure: `layouts/DashboardLayout.tsx` orchestrates panes; `components/ProjectList.tsx`, `KanbanBoard.tsx`, `SessionsPanel.tsx` are leaf components with placeholder content.
- Vite build root is `src/client` — postcss config must be at the project root for Vite to find it.

### 2026-03-13: Project list panel (Issue #8)
- **TanStack Query** (`@tanstack/react-query`) was already a dependency — added `QueryClientProvider` in `App.tsx` with retry=1 and refetchOnWindowFocus=false defaults.
- **API layer**: `src/client/api/types.ts` mirrors server route response shapes; `src/client/api/hooks.ts` provides `useDashboard()`, `useAddProject()`, `useRemoveProject()`, `useIssues()` hooks.
- **ProjectContext** (`src/client/contexts/ProjectContext.tsx`): shared state for selected project. `ProjectProvider` wraps the app; `useSelectedProject()` exposes `selectedProject` and `selectProject()` to any component.
- **ProjectList** uses `/api/dashboard` (not `/api/projects`) to get issue/PR counts per project in a single call, with 60s auto-refetch.
- **Status indicator**: green=healthy, yellow=needs attention (>10 open issues or >5 open PRs), gray=archived. Simple heuristic, real attention badges come in Phase 4.
- **Add project dialog**: Mantine `Modal` with owner/repo text inputs, calls `POST /api/projects`.
- **Remove project**: inline menu with confirmation step (two-click delete pattern).
- **Button nesting**: Mantine `UnstyledButton` renders a `<button>` — using `component="div"` avoids nested-button HTML violations when ActionIcon is inside.
- **@tabler/icons-react** added as dependency (used by KanbanBoard search input).
- **@testing-library/user-event** added as dev dependency for interaction tests.
- Test utils (`src/test-utils/client.tsx`) now wrap with `QueryClientProvider` + `ProjectProvider` for all client component tests.

### 2026-03-13: Kanban board panel (Issue #9)
- **KanbanBoard** (`src/client/components/KanbanBoard.tsx`) — read-only kanban view of GitHub issues with three columns: Todo, In Progress, Done.
- **Column classification** logic: `classifyIssue()` — `CLOSED` → Done; `OPEN` + (assigned OR has "in-progress" label) → In Progress; remaining `OPEN` → Todo.
- **useIssues hook** (`src/client/api/hooks.ts`) makes two parallel TanStack Query calls (open + closed issues) with 30s auto-refetch. Returns combined list + loading/error states.
- **Issue cards** show: `#number`, title (with lineClamp), labels as colored Mantine `Badge` components, assignee avatars via `Avatar.Group` with tooltips (max 3 shown).
- **Filter bar** at top: `TextInput` with search icon filters by title, issue number, or label name — all client-side via `useMemo`.
- **States**: empty state ("Select a project from the sidebar") when no project, `KanbanSkeleton` with Mantine `Skeleton` components while loading, error state with message.
- **Column headers** include issue count as a circular `Badge`.
- **Responsive**: columns use `Flex wrap="wrap"` with `minWidth: 200px` so they stack on narrow screens.
- **Parallel work pattern**: #8 and #9 ran simultaneously on the same filesystem. #8 committed the shared infrastructure (contexts, api hooks/types, providers) along with my KanbanBoard changes. Future parallel work should use separate git branches to avoid this entanglement.

## Phase 1 Summary

**Completed Issues:** #8, #9 (2/8 Phase 1 items)  
**Total Tests Added:** ~50 tests (shared test infrastructure)  
**Commits:** 2 (project list panel, kanban board panel)  

Brand delivered the complete frontend dashboard for launchpad:
1. **Project list panel** — health status badges, add/remove workflows, shared ProjectContext for pane coordination
2. **Kanban board panel** — three-column layout with auto-classification, search filtering, 30s polling for live updates

Both components are built on top of TanStack Query for data fetching and Mantine for UI. ProjectContext enables cross-pane communication without prop drilling.

The kanban board is read-only in Phase 1 (no drag-and-drop). Classification logic is deterministic and matches GitHub-native workflow (CLOSED → Done; OPEN with assignment/label → In Progress; else Todo). Future phases can add interactive features while keeping the core logic unchanged.

Brand's frontend unlocks the entire user experience by consuming Romilly's REST API and displaying the data hierarchy from TARS' persistence layer.

### 2026-03-13: Live sessions panel (Issue #16)
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

