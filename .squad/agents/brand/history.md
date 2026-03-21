# Brand — History

## Core Context

### Architecture (post-#76 refactor)
- **Hooks split into domain files**: `hooks.ts` is a 19-line barrel re-exporting from 6 domain files: `dashboard-hooks`, `daemon-hooks`, `session-hooks`, `conversation-hooks`, `tunnel-hooks`, `settings-hooks`.
- **Workflow hooks**: separate file `workflow-hooks.ts` with issue CRUD, sync, transitions, dispatch, elicitations, activity, coordinator control.
- **CoordinatorCard**: extracted from SessionList into its own component (`CoordinatorCard.tsx`).
- **Conversation renderers**: split from CopilotConversation into `ConversationMessageRenderers.tsx`.

### Patterns
- TanStack Query for all data fetching. WS subscription invalidates queries for real-time updates.
- Scoped WS invalidation: only invalidate specific queries on relevant events (not blanket invalidation).
- Mantine for UI components. AppShell for layout. Dark theme default.
- `authFetch` / `authFetchJson` for all API calls (Bearer token from in-memory auth).
- WebSocket auth uses `getHqToken()` directly.
- Session selection persisted via `sessionStorage` with auto-restore.

### Component Architecture
- Three-pane layout: project list (left), workflow issues (center), session panel (right).
- `DashboardLayout` detects coordinator session and wires agent change callback.
- `WorkflowIssueList` handles issue table with dispatch/done/reject actions, create/edit modals.
- `CopilotConversation` renders streaming messages, tool calls, reasoning, queued/steering bars.
- `SessionList` shows regular sessions + CoordinatorCard at top.

### Gotchas
- `subagent.selected` event must invalidate `session-agent` query for dropdown to update after resume.
- `HIDDEN_EVENT_TYPES` set in renderers controls which SDK events are suppressed in conversation view.
- Queued message bar: set on prompt send, cleared on `user.message` event from SDK.
- Steering bar: set on `system.message` event, auto-dismisses after 8s.

### User Preferences (Arjen)
- Compact UI — buttons use icon-only when space is tight, share lines with status text.
- Coordinator card: attach/detach → new → stop order. Icon-only buttons with tooltips.
- Done issues can be re-dispatched (dispatch button shown on done state).
