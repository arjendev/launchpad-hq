# Brand — Frontend Dev Context

## Core Context

### Architecture
- **Stack:** Mantine v7, TanStack Router + Query, TypeScript, Vite
- **Layout:** Progressive-depth 3-column grid — ProjectList (250px) | SessionList (220px) | Main (flex). Main splits vertically: content area + ResizableTerminalPanel
- **Contexts:** ProjectContext → SessionContext → WebSocketContext → ThemeContext (nested in App.tsx inside MantineProvider)
- **Pages:** `src/client/pages/` for full-page views (SettingsPage, OnboardingPage); `src/client/layouts/` for DashboardLayout
- **Components:** `src/client/components/` — all UI components (30+)
- **Services:** `src/client/services/` — hooks, types, auth, WebSocket client
  - `hooks.ts` — barrel re-export from 6 domain files: dashboard-hooks, daemon-hooks, session-hooks, conversation-hooks, tunnel-hooks, settings-hooks
  - `types.ts` — mirrors server types; **must stay in sync** with server type files
  - `ws-types.ts` — mirrors `src/server/ws/types.ts` Channel/message types
  - `auth.ts` / `authFetch.ts` — token management + authenticated fetch wrapper
  - Feature-specific: `workflow-hooks.ts`, `workflow-types.ts`, `preview-hooks.ts`

### Patterns
- **REST + WebSocket merge:** Fetch initial data via TanStack Query, subscribe to WS channel, invalidate/patch query cache on updates. Any hook fetching daemon-related data must subscribe to the "daemon" WS channel.
- **Auth:** All API calls use `authFetch`/`authFetchJson` (adds Bearer token). Token stored in-memory + sessionStorage. 401 triggers vanilla DOM overlay (works even if React crashes).
- **Mutations:** Invalidate *all* related query keys defensively — better to re-fetch than leave stale data.
- **Barrel re-exports:** When splitting god files, re-export from original path so consumers don't change imports.
- **Settings UI:** Save immediately on interaction (optimistic), no explicit save button.
- **Wizard steps:** `p.note()` for context, then `p.select()` for choices (@clack/prompts).
- **MarkdownContent:** Reusable renderer (`react-markdown` + `remark-gfm`), styles via `ensureStyles()` scoped under `.lp-markdown`.
- **Selective git add:** Always stage specific files, never `git add -A` — parallel agents share the filesystem.

### Gotchas
- **Mantine v7 size props** must be string (`"xs"`, `"sm"`), not numeric — TS enforces this but easy to forget.
- **API response shapes:** Server wraps arrays in objects (e.g., `{ sessions: [], count, adapter }`). Always unwrap in the `queryFn`. Mock the correct shape in tests too.
- **WebSocket mock pattern:** Use `vi.stubGlobal("WebSocket", ...)` + `vi.unstubAllGlobals()`. Do NOT use `vi.restoreAllMocks()` — it clears mock implementations.
- **Fetch mock pattern:** `vi.stubGlobal("fetch", vi.fn(...))` with URL matching. Clean up with `vi.unstubAllGlobals()` in `beforeEach`.
- **Theme FOUC:** `index.html` has inline script that reads `mantine-color-scheme-value` from localStorage before React mounts. Don't remove it.
- **CSS variables:** Use `--lp-*` tokens (defined in `src/client/styles/theme.css`) for theme-aware colors, not raw Mantine variables for borders/backgrounds.
- **Playwright catches what vitest misses:** Always run E2E after frontend changes — jsdom doesn't catch real browser issues.
- **React 18 batching:** Can cause event loss in streaming views — `useConversationEntries` subscribes directly via `subscribe()` callback for this reason.

### User Preferences (Arjen)
- Prefers clean, layered UI — start simple/read-only, add interactivity later
- Dark theme = deep navy "mission control" aesthetic; light theme = clean whites
- Immediate-save settings (no submit buttons)
- Decisions file is `.squad/decisions.md` (authoritative, do not create alternatives)

### Testing
- **Unit:** Vitest + jsdom, Mantine components need test wrapper with all providers (Theme, WebSocket, Project, Session)
- **E2E:** Playwright, Chromium-only, `playwright.config.ts` at project root, `npm run test:e2e`
- **Test utils:** `src/test-utils/client.tsx` — shared provider wrapper for component tests

### WS Channels
Current channels in `ws-types.ts`: daemon, copilot, devcontainer, workflow, preview, inbox

## Learnings

### Event processing extraction (2026-session-events)
- The ~400-line WebSocket event switch in `conversation-hooks.ts` was extracted into `event-processor.ts` as `processSessionEvent()` and `processEventBatch()`.
- Key refs (`toolStarts`, `subagentStack`, `subagentContent`, `currentIntent`, `lastUsage`, `subagentNames`, `mainAgentName`) are consolidated into a single `EventProcessorRefs` object. Both the batch loader and live WS handler share these refs through seeding.
- `processSessionEvent()` supports two modes: `"live"` (for WebSocket — captures raw events, triggers query invalidation, drives streaming deltas) and `"batch"` (for REST replay — skips deltas, creates user entries directly, no side effects).
- `useSessionEvents()` uses `useInfiniteQuery` with reverse cursor pagination (`before` param). Pages are fetched newest-first; flatten in reverse for chronological processing.
- Historical event entries are authoritative for their time range — REST messages only fill timestamps BEFORE the historical coverage. This prevents duplicate user/assistant entries.
- The test fetch mock for `CopilotConversation` must exclude `/events` in the session-detail URL matcher (alongside `/messages`, `/tools`, etc.).
- Windowed rendering uses a `renderCount` approach (render from tail) rather than `visibleStartIndex` — simpler to reason about when entries grow at both ends.
- Mantine's `Transition` component is used for the scroll-to-bottom button animation. `ActionIcon` with `position: sticky` inside `ScrollArea` gives a nice floating effect.

### Cross-Agent Notes (2026-03-22)

#### Romilly's Event Persistence API (commit 52b7d8b)
- REST endpoint shape: `GET /api/copilot/aggregated/sessions/:sessionId/events?before=ISO&limit=N`
- Returns events in chronological order within each page
- Backward pagination via `before` (ISO timestamp cursor)
- Events stored as-is in raw SDK format, capped at 10,000 per session (~5–10MB worst case)
- `StoredEvent` type exported from aggregator
- Cleanup happens on `removeSession()` and `removeDaemon()`
