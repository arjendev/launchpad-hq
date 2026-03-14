# Decisions

## User Directives (Arjen)

### 2026-03-13T18:59:06Z: Follow copilot-sdk conventions for interface design
**By:** Arjen (via Copilot)

When in doubt of interface design, follow `@github/copilot-sdk` (`^0.1.32`). The SDK is published and real. All adapter interfaces should match SDK conventions.

Reference: https://github.com/github/awesome-copilot/blob/main/instructions/copilot-sdk-nodejs.instructions.md

### 2026-03-13T19:00:55Z: Remove mock Copilot adapter
**By:** Arjen (via Copilot)

Remove the mock Copilot adapter — the real SDK is available, no need for mock fallback. SDK is published (`@github/copilot-sdk ^0.1.32`), mock is no longer needed.

## Architecture Decisions (TARS)

### 2026-03-14: SDK Event Type Mapping at Adapter Boundary
**By:** TARS  
**Date:** 2026-03-14

#### Decision
SDK event types use underscores (`tool.execution_start`, `assistant.message_delta`, `assistant.streaming_delta`), while our protocol uses dots/camelCase (`tool.executionStart`, `assistant.message.delta`). Rather than changing our protocol (which is used across daemon, HQ, and frontend), the adapter maps SDK types to our format via `SDK_TO_PROTOCOL_EVENT` lookup table.

Unknown SDK event types pass through as-is with an `as` cast. The `CopilotSessionEventType` union stays narrow for type safety in consumers; the adapter is the one place where we accept the wider SDK surface.

#### Rationale
- Our protocol types are used in 10+ files across server, client, and shared — changing them is high-risk
- The SDK has 50+ event types; our protocol needs only the 10 we display in the UI
- Casting at the adapter boundary is the standard pattern for third-party integrations
- If we need new SDK event types in the UI, we add them to `CopilotSessionEventType` and the mapping table

#### Also: Two-Tier Fallback
The fallback strategy changed from constructor-time (`isSdkAvailable()`) to runtime:
1. If the SDK package isn't importable → mock at construction
2. If the SDK starts but the CLI process fails → catch in `manager.start()`, swap to mock

This handles the case where the SDK npm package is installed but the Copilot CLI binary isn't in PATH.

### 2026-03-14: No mock Copilot adapter in daemon
**By:** TARS  
**Requested by:** Arjen

#### Decision
Removed the daemon-side `MockCopilotAdapter` entirely. `@github/copilot-sdk` is the only Copilot path. No env var toggle (`LAUNCHPAD_COPILOT_MOCK`), no `isSdkAvailable()` fallback. If the SDK fails at runtime (e.g. CLI not in PATH), the daemon continues without copilot capability.

#### Rationale
The real SDK is installed and wired. The mock was a development crutch that added branching complexity and masked real integration issues. One code path is easier to maintain, test, and reason about.

#### Note
The server-side `src/server/copilot/mock-adapter.ts` (used by the copilot aggregator) is a separate concern and was NOT removed — it serves a different purpose (HQ-side session simulation).

### 2026-03-14: PTY spawn must build its own sane environment
**By:** TARS

#### Decision
`DaemonTerminalManager.spawn()` now builds a merged env via `buildShellEnv()` instead of passing raw `process.env`. Guarantees TERM, SHELL, HOME, PATH, LANG, COLORTERM are always set. Spawns login shells (`-l` flag) so profile/bashrc are sourced.

#### Rationale
When the daemon runs backgrounded (e.g. devcontainer `postStartCommand`), `process.env` is minimal and PTY shells hang. This follows the same graceful-degradation pattern as `isSdkAvailable()` — daemon features should never assume a rich environment.

#### Impact
Terminal relay now works reliably in both interactive and backgrounded daemon contexts. `buildShellEnv()` is exported for potential reuse by other daemon modules that need sane shell environments.

## UI Decisions (Brand)

### 2026-03-14: Create Session UI — Button-first, no model selector
**Author:** Brand  
**Date:** 2026-03-14  
**Status:** Implemented

#### Context
Arjen requested a "New Session" button to create Copilot sessions from the UI. The server route (`POST /api/daemons/:owner/:repo/copilot/sessions`) already existed but had no client-side counterpart.

#### Decision
- **Button-only, no model selector.** The task mentioned an optional model selector. Skipped it to keep the UI clean and avoid premature complexity — the default model is fine for now, and a selector can layer on later if users actually need it.
- **Button lives inside `CopilotSessionsSection`**, not as a separate section. It sits above the session cards list so it's contextually obvious what it creates.
- **Daemon-gated interaction**: The button is disabled (greyed out) when the daemon is offline, matching the existing pattern used by the Terminal button. Tooltip explains why.
- **Refactored early-return pattern**: The old `CopilotSessionsSection` used early returns for loading/error/empty states, which would have hidden the create button. Restructured to always render the button first, then conditionally show loading/error/empty/list states below it.
- **Query invalidation on success**: Invalidates both `aggregated-sessions` and `copilot-sessions` query keys so both the project-scoped and global session lists refresh.

#### Alternatives Considered
- Model selector dropdown: Deferred. Can add later as a `Select` next to the button if needed.
- Separate "Create" section with divider: Over-engineered for a single button.

### 2026-03-14: ResizableTerminalPanel — inline panel replaces floating overlay
**Author:** Brand  
**Date:** 2026-03-14  
**Status:** Implemented

#### Context
FloatingConversation used a `position: fixed` overlay (66vw × 66vh) to show active sessions. This blocked the dashboard and didn't integrate with the three-pane layout.

#### Decision
New `ResizableTerminalPanel` component renders as an inline flex child at the bottom of the layout instead of a floating overlay. Uses a simple mousedown/mousemove/mouseup drag handler on a 5px divider — no external resize library needed.

#### Key Choices
- **No library for drag resize** — the interaction is simple enough (track Y delta, clamp to min/max) that a ~20-line handler is cleaner than adding a dependency.
- **Same header patterns as FloatingConversation** — status color map, type badges, detach disconnect, end-session confirm timer all ported as-is. Ensures consistent UX.
- **Terminal.tsx unchanged** — the panel wraps it; no modifications to the terminal internals.
- **Height defaults** — 300px default, 100px minimum, 85vh maximum. These can be adjusted by the consumer via props.

### 2026-03-14: SessionContext disconnect-before-switch pattern
**Author:** Brand  
**Date:** 2026-03-14  
**Status:** Implemented

#### Context
Session selection needs to handle three session types differently when switching:
- **CLI sessions** maintain a terminal connection — must POST `/disconnect` before switching away
- **SDK/Squad sessions** run independently on the daemon — just clear the UI selection

#### Decision
`selectSession()` in SessionContext checks the **outgoing** session's `sessionType`. If `copilot-cli`, it calls `useDisconnectSession` before setting the new selection. For SDK/Squad, it only clears state. The **incoming** session always gets a `useResumeSession` POST regardless of type.

When `selectedProject` changes (detected via useEffect + ref), the current session is auto-detached (CLI only) and selection cleared.

#### Rationale
- Keeps terminal resource cleanup deterministic — no orphaned CLI connections
- SDK/Squad sessions are fire-and-forget from the UI's perspective
- Resume-on-select means single-click is all that's needed to activate a session
- Follows existing mutation hook patterns (`useDisconnectSession`, `useResumeSession` from hooks.ts)

#### Impact
- SessionList can be a simple click-to-select list — no separate "Resume" modal needed for basic flow
- ConnectedProjectPanel's CopilotSessionsSection resume modal pattern still works for explicit resume with config
- Future: session type helpers (timeAgo, statusColor, typeColor, typeLabel) are duplicated between ConnectedProjectPanel and SessionList — should extract to shared utils when a third consumer appears

### 2026-03-14: Inbox System Backend Architecture
**Author:** Romilly  
**Date:** 2026-03-14  
**Status:** Implemented

#### Context
Agents call `request_human_review` and `report_blocker` tools. These need to surface as inbox messages in the UI, persisted per-project in the launchpad-state repo.

#### Decisions
1. **Per-project inbox files** — Inbox state stored at `inbox/{owner}/{repo}.json` in launchpad-state repo, not in a single global file. Rationale: avoids write contention when multiple projects generate messages simultaneously.

2. **Reuse readState/writeState** — No new generic plumbing in StateManager — the existing private `readState()` and `writeState()` methods accept arbitrary paths. Added `inboxPath()` helper for path construction.

3. **Separate "inbox" WS channel** — Created a dedicated `"inbox"` channel rather than overloading `"attention"`. This lets the UI subscribe only to inbox events for badge updates without receiving all attention noise. The existing attention broadcast remains for backward compatibility.

4. **Fire-and-forget persistence** — Tool invocation → inbox message creation uses `.then()` chains (not `await`) in the copilot-aggregator plugin's event handler. Prevents blocking the event loop on GitHub API latency. Errors are logged but don't crash the handler.

5. **Title derivation** — `args.title ?? args.message ?? args.reason ?? tool name` — covers the known arg shapes of both `request_human_review` and `report_blocker` tools, with a sensible fallback.

#### API Surface
| Endpoint | Method | Description |
|---|---|---|
| `/api/projects/:owner/:repo/inbox` | GET | List messages (filter by `?status=` and `?sessionId=`) |
| `/api/projects/:owner/:repo/inbox/count` | GET | `{ unread: number }` for badge |
| `/api/projects/:owner/:repo/inbox/:id` | PATCH | Update status to `read` or `archived` |

### 2026-03-14: Progressive-Depth Dashboard Layout
**Author:** Brand  
**Date:** 2026-03-14  
**Status:** Implemented

#### Context
The old DashboardLayout was a horizontal 3-pane split: ProjectList (250px) | KanbanBoard (flex) | ConnectedProjectPanel (300px). With SessionList and ResizableTerminalPanel now available, the right panel (ConnectedProjectPanel + FloatingConversation overlay) is being phased out in favor of an inline session experience.

#### Decision
Rewrite DashboardLayout to a progressive-depth layout:
```
┌──────────┬────────────┬────────────────────────────────────┐
│ Projects │  Sessions  │  Main content (top)                │
│ (250px)  │  (220px)   ├────────────────────────────────────┤
│          │            │  ResizableTerminalPanel (bottom)    │
└──────────┴────────────┴────────────────────────────────────┘
```

- **Column 1 (250px):** ProjectList — unchanged.
- **Column 2 (220px):** SessionList — new session browser with create/select.
- **Column 3 (flex):** Vertical split — KanbanBoard on top, ResizableTerminalPanel on bottom (only when session selected).
- **Conditional rendering:** Empty state → KanbanBoard only → KanbanBoard + Terminal panel.
- **ConnectedProjectPanel and FloatingConversation removed** from imports and renders.

#### Consequences
- The right panel slot (300px) is freed. Session management is now in its own dedicated column.
- Terminal/conversation is inline (VS Code-style bottom panel), not a floating overlay.
- KanbanBoard will be replaced by BacklogList in a future iteration — the layout is ready for that swap.
- ConnectedProjectPanel can be fully deleted once no other route references it.

### 2026-03-14: InboxPanel Component Architecture
**Author:** Brand  
**Date:** 2026-03-14  
**Status:** Implemented

#### Context
Arjen requested an InboxPanel component to display inbox messages (from `request_human_review` and `report_blocker` tool calls) scoped to the selected session, sitting alongside the kanban/backlog area.

#### Decisions
1. **Dual-query fetch strategy** — `useInbox` runs two parallel TanStack queries — one for `status=unread`, one for `status=read` — then merges results client-side sorted newest-first. This matches the server API shape (single status param per request) while giving the UI all visible messages in one merged list.

2. **WebSocket-driven cache invalidation (not patching)** — Unlike the copilot sessions hook which patches query cache directly from WS payloads, the inbox hooks simply **invalidate** the query key on any `inbox` channel WS message. This is simpler and safer — the server is the source of truth for message state transitions (unread → read → archived). TanStack re-fetches automatically after invalidation.

3. **Session scoping via context** — The panel reads `useSelectedSession()` directly rather than accepting a sessionId prop. This keeps the component self-contained and avoids prop threading. When no session is selected, messages for the entire project are shown.

4. **Upgraded useInboxCount with WS subscription** — The pre-existing `useInboxCount` hook only polled every 30s. Added `inbox` channel subscription so badge counts on the project list update in near-real-time when new messages arrive.

### 2026-03-14: Kanban → BacklogList + Component Cleanup
**Author:** Brand  
**Date:** 2026-03-14  
**Status:** Implemented

#### Context
The 3-column KanbanBoard (Todo / In Progress / Done) was replaced with a flat BacklogList. The kanban layout consumed too much horizontal space and didn't add value for the project's workflow — most interaction is scanning open work, not drag-and-drop triage.

#### Decision
1. **BacklogList replaces KanbanBoard** — single sorted list, in-progress first, todo second, done collapsed at bottom with toggle. Same `classifyIssue()` logic. Click-to-open-in-GitHub.
2. **InboxPanel sits alongside BacklogList** — 250px fixed + flex:1 horizontal split in the main content area.
3. **Deleted dead components:** FloatingConversation, ConnectedProjectPanel, TerminalOverlay — these were superseded by the ResizableTerminalPanel and SessionList redesign.

#### Impact
- Simpler layout, less horizontal competition
- Fewer components to maintain (3 files + 2 test files removed)
- Build size slightly reduced
- All 738 unit tests pass, build clean

## User Directives (Arjen) — Session & Rendering

### 2026-03-14T07:24Z: All SDK session events in conversation view
**By:** Arjen (via Copilot)

All SDK session events should be rendered in the conversation view. Streaming assistant message deltas should be aggregated per message. Later we'll decide what to show for how long.

### 2026-03-13T21:32: Session API redesign
**By:** Arjen (via Copilot)

- Remove daemonId/projectId from client-facing session API — projectId is known from UI context, assume 1 daemon per project (use last connected if multiple)
- Resume session: new UI flow with modal showing existing sessions (startedAt, updatedAt, status, summary)
- Full SDK control panel in UI: send, abort, end, setModel, mode get/set, plan read/update/delete, disconnect
- Log all events received by UI for debugging
