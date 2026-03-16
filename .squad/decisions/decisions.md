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

### 2026-03-15: EventEmitter error listener pattern

All EventEmitter subclasses in the server MUST register a default `error` event listener in their constructor. Without one, Node.js throws unhandled errors that crash the process.

**Pattern:**
```typescript
constructor(options) {
  super();
  this.on("error", (err) => {
    this.logger?.warn({ err: err.message }, `Error: ${err.message}`);
  });
}
```

**Rationale:** The TunnelManager was crashing the entire server when `devtunnel` CLI was missing or auth expired. This is a Node.js foot-gun — any EventEmitter that emits `error` with no listener throws. The fix is defensive: always install a default listener, let consumers add additional ones.

**Also established:**
- `tunnelErrorGuidance()` pattern: map error codes to actionable user messages. Reuse this for any CLI-wrapping module.
- Tunnel auto-start is fire-and-forget (`.then()`) — never block server boot on optional features.

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

## Architecture Decisions (Romilly)

### 2026-03-15: State management modes — LocalStateManager + GitStateManager

StateManager has been refactored to support two pluggable backends:
- **LocalStateManager:** Reads/writes to `~/.launchpad/config.json` for offline-first operation
- **GitStateManager:** Persists to `launchpad-state` repo via GitHub API for multi-device sync

Both implement the `StateService` interface, making them consumer-agnostic. The choice of backend is determined at runtime based on environment (e.g., offline vs. connected).

**LaunchpadConfig Type:** Centralized in `src/server/state/types.ts` and shared with the onboarding wizard:
```typescript
interface LaunchpadConfig {
  trackedRepos: ProjectConfig[];
  copilot?: { /* agent preferences, etc */ };
  tunnel?: { configured: boolean; mode: string; };
  onboardingComplete?: boolean;
}
```

**Settings API:**
- `GET /api/settings` — read current config
- `PUT /api/settings` — save config with validation

**Rationale:** Separation of concerns allows offline operation (LocalStateManager) while supporting cloud sync (GitStateManager). The shared LaunchpadConfig type prevents drift between the settings API and the onboarding wizard.

## UI Decisions (Brand)

### 2026-03-15: Onboarding wizard framework (@clack/prompts)

The onboarding wizard runs in the CLI before server import using `@clack/prompts` for terminal UI. It steps through copilot setup, tunnel configuration, and other initialization tasks, then persists the final LaunchpadConfig via Romilly's `/api/settings` PUT endpoint.

**Key choices:**
1. **@clack/prompts over inquirer** — Cleaner API, built-in `isCancel()` for Ctrl+C detection, smaller bundle.
2. **Shared LaunchpadConfig type** — Extended Romilly's type in `src/server/state/types.ts` rather than creating a parallel one. Prevents type drift.
3. **Async save via Romilly's launchpad-config.ts** — Config persistence uses the shared `saveLaunchpadConfig()`. The wizard's `onSave` callback allows test injection.
4. **Non-interactive fallback** — When no TTY is detected (CI, Docker, piped input), the wizard auto-applies defaults and marks onboarding complete. No prompts shown.

**Framework:** WizardStep interface with `prompt()`, `validate()`, `apply()` hooks enables pluggable step implementations.

**Impact on other agents:**
- **TARS (#45):** DevTunnel step must set `tunnel.configured` and `tunnel.mode` in the config.

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

## Issue #54 Decisions — Preview Feature

### 2026-03-15: Preview UI architecture — hooks + modular components
**Author:** Brand  
**Date:** 2026-03-15  
**Issue:** #54  
**Status:** Implemented

Separated preview hooks into a dedicated `src/client/services/preview-hooks.ts` file rather than adding to the already-large `hooks.ts` (1490 lines). This improves discoverability and keeps the preview feature cohesive.

**Architecture choices:**
1. **Dedicated hooks file** — `preview-hooks.ts` contains all preview-related hooks, mutations, and helpers
2. **WebSocket invalidation pattern** — Invalidate TanStack Query caches on `preview:config` events; server as source of truth
3. **PreviewButton as wrapper** — Button component owns modal lifecycle, keeping ProjectItem clean
4. **PreviewPanel as standalone** — Can be placed anywhere in layout without coupling to ProjectList
5. **URL helpers as pure functions** — `buildPreviewUrl()` and `formatDetectionSource()` are testable utilities

**Consequences:** Preview feature is self-contained (one hooks file, three components, one test file). Adding new preview features only touches these files.

### 2026-03-15: Preview Proxy — Server-Side Architecture (Option A)
**Author:** Romilly  
**Date:** 2026-03-15  
**Issue:** #54  
**Status:** Implemented

Implemented single-tunnel path-based routing for preview. All preview traffic flows through HQ Fastify without per-project tunnels.

**Key design choices:**
1. **Request/response matching via Map + Promise** — Each proxy request gets a `randomUUID()` requestId with pending Map tracking. 30s timeout produces 504.
2. **Base64 body encoding** — Request/response bodies base64-encoded for binary safety over WebSocket
3. **Registry as source of truth** — `previewPort`, `previewAutoDetected`, `previewDetectedFrom` stored on `TrackedDaemon`
4. **"preview" WS channel** — New browser WS channel for real-time preview config updates
5. **Plugin dependency chain** — Preview plugin depends on `["websocket", "daemon-registry", "tunnel"]`

**Consequences:** Preview URLs deterministic; all HTTP methods supported; no per-project tunnels; acceptable latency for dev preview.

### 2026-03-15: Preview Proxy — Daemon Side (Option A)
**Author:** TARS  
**Date:** 2026-03-15  
**Issue:** #54  
**Status:** Implemented

Daemon proxies HTTP requests and WebSocket frames over the existing daemon↔HQ WebSocket connection instead of spinning up per-project DevTunnels.

**Key Design Choices:**
1. **Base64 body encoding** — All HTTP bodies and WebSocket frames base64-encoded for binary safety
2. **Error mapping** — ECONNREFUSED → 404, proxy errors → 502, timeouts → 504
3. **3-tier port detection** — devcontainer.json → package.json heuristics → port scan; falls back gracefully
4. **WS relay by channelId** — Each browser WebSocket gets unique channelId; daemon opens matching local WebSocket and bridges data. Enables HMR/live-reload through tunnel.
5. **No new dependencies** — Uses Node.js built-in `http` and `net` modules only

**Risks:** Base64 adds ~33% overhead (acceptable for dev previews); port scan may have false positives (explicit config preferred).

## Issue #46 Decisions — Settings

### 2026-03-15: Settings page architecture — separate full-page route
**Author:** Brand  
**Date:** 2026-03-15  
**Issue:** #46  
**Status:** Implemented

The Settings page is a **standalone route** (`/settings`) with its own `AppShell` layout, not a modal or sidebar. Navigation via gear icon in header + back arrow on settings page.

**Rationale:**
- Settings needs scroll space for 4+ sections — modal would be cramped
- Separate route makes it linkable/bookmarkable
- Keeps DashboardLayout clean
- Introduced `src/client/pages/` directory for full-page views

**Impact:** New directory: `src/client/pages/` for future pages. `LaunchpadConfig` duplicated in client types (consider shared types package if drift occurs).

## Onboarding & Configuration Decisions

### 2026-03-14: Wizard step UI pattern and config defaults
**Author:** Brand  
**Date:** 2026-03-14  
**Issue:** #41–#43  
**Status:** Implemented

Implementing onboarding wizard steps required decisions about prompt style and default values.

**Decisions:**
1. **Step prompt pattern: note() + select()** — Each step uses `p.note()` for context, then `p.select()` for action
2. **Default config values updated:**
   - `copilot.defaultSessionType`: `"cli"` → `"sdk"`
   - `copilot.defaultModel`: `"claude-sonnet-4"` → `"claude-opus-4.6"`
3. **AVAILABLE_MODELS as curated const array** — Hardcoded currently (6 models); can be replaced with SDK runtime discovery

**Impact:** Config shape unchanged. Default values changed (may affect tests). DevTunnel step (#44) remains placeholder.

### 2026-03-15: DevTunnel Wizard Step — Polling Auth Instead of Spawning Login
**Author:** TARS  
**Date:** 2026-03-15  
**Issue:** #44  
**Status:** Implemented

DevTunnel wizard step does NOT spawn `devtunnel user login`. Instead, instructs user to run in another terminal and polls `devtunnel user show` every 3s for up to 2 minutes.

**Why:**
1. **@clack/prompts conflict** — Wizard UI controls stdin/stdout; spawning interactive child would conflict
2. **Devcontainer compatibility** — `devtunnel user login` may try to launch browser; user's terminal gives full control
3. **Simplicity** — Polling is straightforward, testable, no child process lifecycle management

**Trade-offs:** User must open second terminal (friction); 2-minute timeout may not cover slow auth (falls back gracefully).

### 2026-03-15: LaunchpadConfig routed through state repo in git mode
**Author:** Romilly  
**Date:** 2026-03-15  
**Issue:** #51  
**Status:** Implemented

When `stateMode === "git"`, ALL configuration (including LaunchpadConfig) goes to state repo as `launchpad-config.json`. Only bootstrap config (`~/.launchpad/config.json`) stays local, containing just `{ version, stateMode, stateRepo }`.

**Key Design Choices:**
1. **Bootstrap fields from local only** — Can't bootstrap from git without knowing where git is
2. **StateService interface extended** — `getLaunchpadConfig()` / `saveLaunchpadConfig()` added
3. **Plugin resolves full config at boot** — `fastify.launchpadConfig` is authoritative at runtime
4. **Dual-write on PUT in git mode** — Full config → state repo, bootstrap-only → local file
5. **Migration includes LaunchpadConfig** — Switching local→git captures and migrates alongside other configs

**Impact:** State repo in git mode will contain `launchpad-config.json` alongside `config.json`, `preferences.json`, `enrichment.json`.

## Issue #51 Decisions — Project Onboarding

### 2026-03-15: Project Onboarding Backend API Surface (#51)
**Author:** Cooper  
**Date:** 2026-03-15  
**Issue:** #51  
**Status:** Implemented

Issue #51 redesigns Add Project flow into multi-step wizard with new backend search endpoints.

**Decisions:**
1. **GitHub Search API for discovery:**
   - `GET /api/discover/users?q=` uses `GET /search/users`
   - `GET /api/discover/repos?owner=&q=` uses `GET /search/repositories` (filtered) or `GET /user/repos` (unfiltered)
   - Both use `fastify.githubToken`
   - Rate limit: 30 req/min; UI should debounce
2. **runtimeTarget made optional** — `POST /api/projects` no longer requires it; defaults to `"local"` if omitted
3. **Daemon CLI args as highest-priority config** — `--hq-url`, `--token`, `--project-id` parsed before startup
   - Supports `--flag value` and `--flag=value` syntax
   - Priority: CLI args → env vars → `.launchpad/daemon.json` → defaults
   - Enables: `npx github:arjendev/launchpad-hq --daemon --hq-url ws://... --token <TOKEN> --project-id owner/repo`

## Infrastructure & Monitoring

### 2026-03-15: Notification Architecture Brainstorm (Design Phase)
**Author:** Cooper  
**Date:** 2026-03-15  
**Status:** Design brainstorm — not yet approved

**Problem:** When a Copilot agent completes work, hits a blocker, or needs human judgment, the user needs to know — wherever they are.

**What's Already Built:**
- Agent-side: Three HQ tools in `src/daemon/copilot/hq-tools.ts` (`report_progress`, `request_human_review`, `report_blocker`)
- Server-side: Inbox system (messages + REST API) + Attention system (rule engine)
- Client-side: InboxPanel, unread badge on project list

**Five Approaches Identified:**
1. **Agent-Tool Driven (Explicit)** — Agents call `request_human_review` or `report_blocker` (already implemented)
2. **Session-State Driven (Implicit)** — Detect idle sessions with `evaluateSessionIdle()` stub
3. **Hybrid Approach (Recommended Foundation)** — Layer: explicit tools + SDK waiting state + idle detection + escalation
4. **Push Notifications (Browser)** — Notification API + optional service worker
5. **External Notification Webhook** — POST to ntfy.sh, Pushover, Slack, etc.

**Recommendation:** Start with hybrid approach (layer 3). For push, use browser Notifications API (4a) + optional webhook (5c). Skip service worker (4b) — mobile browsers kill background connections.

## Security & Compliance

### 2026-03-15: Final Security Review — Dual Perspective
**Authors:** Cooper (Opus 4.6) + Cooper (GPT-5.4)  
**Date:** 2026-03-15  
**Issue:** #61  
**Status:** Findings merged, consolidated into issue for remediation planning

Comprehensive security audit completed with two independent reviewers to surface control-plane and token-handling risks.

**Consolidated Findings (Deduplicated):**

**CRITICAL — Release Blockers (2):**
- **C1:** HTTP control plane is unauthenticated — all `/api/*` routes lack session/bearer token gates, CSRF protection
  - **Impact:** Anyone reaching HQ port can spawn terminals, start/stop daemons, inject Copilot prompts, toggle tunnels
  - **Priority:** Must fix before public release
- **C2:** Unauthenticated endpoints leak `sessionToken` (WS auth) and `daemonToken` (daemon bearer)
  - **Locations:** `GET /api/settings`, `GET /api/projects/:owner/:repo`, `/regenerate-token`
  - **Impact:** Remote party can immediately impersonate browser/daemon for full control-plane compromise

**HIGH — Should Fix Soon (4):**
- **H1:** Session Token Exposed via REST API — `/api/settings` returns WS auth token in response body
- **H2:** No Auth on REST API Routes — applies to all endpoints when tunnel is active
- **H3:** Copilot Tool Permissions Auto-Approved — `approveAll` bypasses human review loop
  - **Risk:** If HQ compromised or prompt injection occurs, attacker can execute arbitrary Copilot tools
- **H4:** Preview Proxy — turns tunnel URL into unauthenticated localhost access
  - **Risk:** Reaches private dev servers, hot-reload channels, localhost-only admin routes

**MEDIUM — Defense-in-Depth (8):**
- **M1:** Preview Port Validation — daemon can set previewPort to well-known services (SSRF)
- **M2:** No Rate Limiting on API Routes — discover endpoints proxy GitHub API directly
- **M3:** CORS Configuration only in dev mode — no explicit restrictions in production
- **M4:** WebSocket Origin Validation — browser client not validated, query-string tokens leak to logs
- **M5:** `execSync` Git Remote Parsing — crafted remote URLs could inject characters
- **M6:** Daemon Token in State Repo — leaked if state repo compromised or public
- **M7:** Daemon tokens are long-lived without expiry policy — no rotation mechanism
- **M8:** Terminal startup trusts ambient SHELL/PATH — can be poisoned on shared hosts

**LOW — Best Practices (8):**
- **L1:** No Content Security Policy headers
- **L2:** Session token not rotated during server lifetime
- **L3:** Postinstall script patches node_modules (invasive but deterministic)
- **L4:** `node-pty` spawn uses user's $SHELL (standard Unix model)
- **L5:** Preview proxy body size unlimited
- **L6:** Verbose preview detection logging (info leakage)
- **L7:** Client debug logger in browser path
- **L8:** Daemon token visible in CLI args (process list leakage)

**Priority Fix Order:**
1. **C1/C2** — Add HTTP auth gate on all `/api/*` routes; stop returning secrets from endpoints
2. **H1/H3** — Remove secrets from response bodies; disable `approveAll` for production
3. **H2/H4** — Require auth before tunnel/preview exposure; validate origins
4. **M7/M1** — Add token expiry/rotation policy; validate preview ports
5. **L1** — Add security headers (@fastify/helmet)

**Key Strengths Noted:**
- Crypto primitives solid (randomBytes, timingSafeEqual, protocol design)
- Input validation consistent (OWNER_REPO_REGEX, path traversal guards)
- Zero npm audit vulnerabilities (production dependencies clean)
- Challenge-nonce daemon auth is well-designed
- WebSocket protocol is type-safe (discriminated unions)

**Notes:**
Architecture is fundamentally sound for single-user local tool but requires hardening before multi-user or remote access. Control-plane unauthentication is the biggest gap; it becomes critical as soon as Dev Tunnels expose the API.

**Reports:**
- Opus 4.6 (agent-89): `/workspaces/launchpad/.squad/decisions/inbox/cooper-security-review-opus.md`
- GPT-5.4 (agent-90): `/workspaces/launchpad/.squad/decisions/inbox/cooper-security-review-gpt.md`
- **Issue:** github.com/arjendev/launchpad-hq/issues/61

## Implementation Decisions (Phase 2)

### 2026-03-16: Issue Grooming — #66, #67, #68
**By:** Cooper  
**Date:** 2026-03-16

Three issues now properly scoped and ready for implementation:

**Issue #66: Render markdown in Copilot SDK conversation view**
- **Type:** Enhancement | **Labels:** enhancement, frontend, copilot-sdk
- **Problem:** SDK agent responses contain markdown but render as plain text
- **Solution:** Use markdown-to-jsx or rehype-react with XSS protection
- **Acceptance:** Headers, code blocks, lists, bold, italic, links render properly with syntax highlighting

**Issue #67: Projects overview doesn't update daemon online/offline status**
- **Type:** Bug | **Labels:** bug, frontend
- **Problem:** Daemon info bar updates but projects list doesn't refresh in real-time
- **Root cause:** WebSocket subscription or state propagation issue between UI components
- **Solution:** Fix TanStack Query cache propagation or missing useEffect dependency
- **Acceptance:** Status matches daemon info bar on connect/disconnect, no manual refresh needed

**Issue #68: Onboarding — offer choice between terminal and browser flows**
- **Type:** Enhancement | **Labels:** enhancement, cli
- **Problem:** CLI unconditionally opens browser, doesn't support terminal-only or SSH/headless environments
- **Solution:** Prompt user at startup: "Complete setup in [1] Terminal or [2] Browser?"
- **Acceptance:** Both flows result in identical final config, choice saved in LaunchpadConfig

### 2026-03-16: Client-side auth implementation (Brand)
**By:** Brand  
**Date:** 2026-03-16

Token persistence and client-side auth architecture implemented per Issue #65.

**Decision: sessionStorage for token persistence**
- **Why sessionStorage:** Per-tab isolation, auto-cleanup on tab close, right security boundary for session tokens
- **Why not localStorage:** Too long-lived for session tokens, requires explicit cleanup
- **Implementation:** `setHqToken()` writes to memory + sessionStorage; `getHqToken()` checks memory first, falls back to sessionStorage; `initAuthFromUrl()` checks URL param first (fresh open), then sessionStorage (refresh); `clearHqToken()` for explicit cleanup

**Files changed:**
- `src/client/services/auth.ts` (token storage)
- `src/client/services/authFetch.ts` (centralized auth wrapper)
- `src/client/main.tsx` (URL cleanup)
- `src/client/services/hooks.ts`, `preview-hooks.ts` (replace fetchJson with authFetchJson)
- `src/client/components/*` (replace raw fetch with authFetch)
- `src/client/services/ws.ts` (token from getHqToken directly, no extra API call)

**Status:** Implemented and committed. Full suite green (1022 tests).

**Related:** Server-side URL token auth + security hardening at `.squad/decisions/decisions.md` (Romilly, 2026-03-15)

### 2026-03-16: Server-side auth + security hardening (Romilly)
**By:** Romilly  
**Date:** 2026-03-15

Jupyter-style hqToken auth with CORS, helmet security headers, and preview port validation for Issue #61.

**Decisions:**
1. **URL-based token auth** — Bearer token via `Authorization` header or `?token=` query param
2. **Health endpoint exempt** — `/api/health` allows monitoring/load balancer probes without auth
3. **CORS in all modes** — Dynamic origin callback (localhost + active tunnel URL)
4. **@fastify/helmet for security headers** — CSP allows inline scripts/styles (Vite/Mantine pragmatic trade-off)
5. **Preview port blocklist** — Infrastructure ports blocked from preview proxy (SSH, PostgreSQL, Redis, etc.)
6. **File permissions** — Directories 0o700, files 0o600 (prevent other users on same machine from reading)

**Status:** Implemented. Full suite green (1022 tests).

### 2026-03-16: Daemon hardening — Token redaction + auth timeout (TARS)
**By:** TARS  
**Date:** 2026-03-16

Defense-in-depth measures for daemon security per Issue #61, Phase 2.

**H4 — Token Redaction**
- `process.title` set to `'launchpad-hq daemon'` after reading `--token` in `src/cli.ts`
- Prevents `ps aux` from showing token to co-resident users
- Convention: Any future CLI args with secrets must be redacted from `process.title` before processing

**H5 — Auth Handshake Timeout**
- New constants: `AUTH_HANDSHAKE_TIMEOUT_MS = 15_000`, `WS_CLOSE_AUTH_TIMEOUT = 4002`
- `PendingConnection` carries `authTimer` field
- Every code path (auth success, rejection, disconnect, cleanup) must `clearTimeout()` to avoid leaks
- Prevents malicious daemon from holding WebSocket open indefinitely

**Test coverage:** 4 new tests in `daemon-registry.test.ts` using fake timers + 1 for process.title redaction.

**Status:** Implemented. Full suite passing.

### 2026-03-16: Onboarding flow choice via env var signal (Romilly)
**By:** Romilly  
**Date:** 2026-03-16

Terminal vs Browser flow selection at startup for Issue #68.

**Decision: Process env var signal**
- `process.env.LAUNCHPAD_OPEN_ONBOARDING` set by `cli.ts` when user chooses Browser
- When set, wizard is skipped and server opens browser to `/onboarding?token=<token>` after startup
- Avoids coupling `cli.ts` to server internals (port, token)
- Server already knows its own URL — let it handle browser opening
- Env var is process-scoped, no cleanup needed

**Both paths produce identical LaunchpadConfig end state.**

**Status:** Implemented. Full suite passing (1022 tests).
