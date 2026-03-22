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

## Phase 1 Workflow System (Romilly)

### 2026-03-20: Workflow Phase 1 — State Machine, GitHub Sync, and API

**Author:** Romilly (Backend Dev)  
**Date:** 2026-03-20  
**Issue:** #72  
**Status:** Implemented

#### Context
Launchpad needs a workflow management system to track GitHub issues through HQ-defined lifecycle states. Phase 1 establishes the backend foundation.

#### Decisions Made

**1. State model: 6 states, directional transitions only**
States: `backlog → in-progress → {needs-input-blocking, needs-input-async, ready-for-review} → done`

No backward transitions except `ready-for-review → in-progress` (request changes) and input states back to `in-progress`. The `done` state is terminal. This mirrors a real development workflow.

**2. Label mapping: 4 GitHub labels, not 6**
`needs-input-blocking` and `needs-input-async` both map to `hq:in-progress` on GitHub. Only 4 labels needed: `hq:backlog`, `hq:in-progress`, `hq:review`, `hq:done`. The blocking/async distinction is HQ-internal.

**3. Comments only for input requests and completion**
We don't spam GitHub issues with comments for every state change. Only post comments when:
- Input is requested (blocking or async) — devs need to know
- Issue is marked done — clear signal

**4. Persistence: piggyback on enrichment data**
Instead of creating new state files in the state repo, workflow state is stored as `workflowState` metadata on enrichment entries. This avoids adding new files to the state repo schema and reuses the existing flush/sync infrastructure.

**5. GitHub token: use `server.githubToken` decorator**
The `github-auth` plugin already captures the token at startup. Workflow routes use the decorator instead of shelling out to `gh auth token` on every request.

**6. Sync is client-triggered, not background polling**
No background polling. The client calls `POST /api/workflow/:owner/:repo/sync` when the user wants fresh data. This keeps the server predictable and avoids rate-limit concerns.

#### Implementation
- `src/server/workflow/state-machine.ts` — State machine + types
- `src/server/workflow/github-sync.ts` — GitHub sync service
- `src/server/workflow/store.ts` — In-memory store with flush
- `src/server/routes/workflow.ts` — REST API (Fastify plugin)
- `src/server/workflow/__tests__/*.test.ts` — 64 tests
- Registered workflow routes in `src/server/index.ts`

## Phase 1 Workflow Frontend (Brand)

### 2026-03-20: Workflow Phase 1 Frontend — WorkflowIssueList, Hooks, Badges

**Author:** Brand (Frontend Dev)  
**Date:** 2026-03-20  
**Issue:** #72  
**Status:** Implemented

#### Context
Frontend integration for workflow management system alongside backend implementation.

#### Decisions Made

**1. REST + WebSocket merge pattern**
- Fetch initial data via API
- Subscribe to "workflow" channel
- Patch TanStack Query cache on WebSocket updates
- Ensures UI stays in sync without excessive polling

**2. Three custom hooks for data layer**
- `useWorkflowIssues(owner, repo)` — fetch + WS refetch
- `useSyncIssues(owner, repo)` — POST mutation
- `useTransitionIssue(owner, repo)` — PUT mutation
- All use `authFetch`/`authFetchJson` pattern for auth header injection

**3. WorkflowIssueList component design**
- Compact Mantine Table (not drag-and-drop yet)
- Sortable by status/number/age
- Filterable by text + status dropdown
- Row actions: Approve/Reject for review, Respond for input, overflow menu for others
- Sync button with loading state
- Empty state messaging

**4. Project integration**
- WorkflowBadge component in ProjectList: 🟡🔵🟢 status indicators
- SegmentedControl tabs in DashboardLayout: "📋 Backlog" and "🔄 Workflow"
- Both desktop and mobile layouts supported

**5. Type alignment**
- `src/client/services/workflow-types.ts` mirrors server types
- Display config (colors, emojis, sort order) co-located with types

#### Implementation
- `src/client/services/workflow-types.ts` — 6-state enum, types, display config
- `src/client/services/workflow-hooks.ts` — three hooks
- `src/client/components/WorkflowIssueList.tsx` — main component (695 lines)
- Integration points: ProjectList.tsx, DashboardLayout.tsx
- Added "workflow" to client ws-types.ts Channel union
- All components follow Brand's patterns (TanStack Query, Mantine, hooks)

## npm Publishing Strategy (Cooper, Romilly)

### 2026-03-20: npm Publishing Strategy — Registry, Trusted Publishers, Package Name

**Authors:** Cooper (Research), Romilly (Implementation)  
**Date:** 2026-03-15 to 2026-03-20  
**Issue:** #69  
**Status:** Implemented (Workflow), Proposed (Trusted Publishers)

#### Context
Launchpad needs to be distributed via npm registry with supply-chain security.

#### Decisions Made

**1. Package name: unscoped `launchpad-hq`**
- More user-friendly: `npx launchpad-hq` >> `npx @arjendev/launchpad-hq`
- Name is available on npm registry
- Claim immediately to prevent squatting

**2. Publish triggers on GitHub release + manual dispatch**
- `publish.yml` workflow triggers on `published` release event
- `workflow_dispatch` added for testing
- Keeps npm versions in sync with GitHub releases

**3. npm Trusted Publishers (OIDC)**
- No `NPM_TOKEN` secret stored in GitHub
- GitHub Actions generates short-lived OIDC tokens per publish
- npm validates against trusted publisher config on npmjs.com
- First publish is manual (Arjen): `npm publish --access public` to claim name
- Then configure trusted publisher on npmjs.com
- Supply-chain verified via provenance attestations (automatic)

**4. Metadata fields**
- Added `repository`, `homepage`, `bugs` to package.json
- Standard npm registry metadata for discoverability

**5. Windows tarball remains as fallback**
- Original tarball workaround for NTFS file locks
- npm registry installs deliver pre-built `dist/` (no `prepare` execution)
- GitHub Release tarball stays as fallback but no longer primary recommendation

**6. Install instructions update across team**
- All references to `npx github:arjendev/launchpad-hq` must update to `npx launchpad-hq`
- Affects: README.md, docs, UI (DaemonSetupInstructions.tsx), CLI help text
- Coordinated PR after first publish verified

#### Implementation (Romilly)
- `publish.yml` workflow with `--provenance` flag
- `id-token: write` permission for OIDC
- Build + test gate before publish
- `NODE_AUTH_TOKEN` secret required initially (before OIDC configured)

#### User Directive (Arjen)

### 2026-03-16: Always use Opus 4.6 for agent spawns

**Author:** Arjen (via Copilot)  
**Date:** 2026-03-16T16:10:26Z  
**Status:** Team directive

All agent spawns must use Opus 4.6 (`claude-opus-4.6`). This is the user's preferred model for quality and capabilities. Captured for team memory.

## Context Injection Research Findings (Cooper)

### 2026-03-20: HQ-Level Context Injection — MCP/Skills/Instructions Research

**Author:** Cooper (Lead)  
**Date:** 2026-03-20  
**Issue:** #73  
**Status:** Proposed (Research Complete)

#### Context
Research spike exploring whether HQ could inject shared context — MCP servers, tools, skills, instructions — into per-project Copilot SDK sessions.

#### Findings

**SDK Support Is Comprehensive**
The `@github/copilot-sdk@0.1.32` already supports everything needed:
- **MCP servers:** `SessionConfig.mcpServers` with local (stdio) and remote (HTTP/SSE) transports
- **Tools:** `defineTool()` at session creation/resume, JSON Schema parameters
- **Skills:** `skillDirectories` + `disabledSkills` for directory-based skill loading
- **System prompt:** `systemMessage: { mode: 'append' | 'replace' }` for instruction injection

**Gap Analysis**
Gap is not in SDK — it's in wire protocol. `SessionConfigWire` needs `mcpServers` added (one field). `buildSharedSdkConfig()` needs to pass it through (one spread).

**Recommended Phased Approach**

1. **Phase 1 — MCP Pass-Through + Instruction Layering** (~3-4 days)
   - Wire types, daemon passthrough, project config, layered system prompt composition
   - Builds on Issue #60
   - Low-risk, high-value

2. **Phase 2 — HQ Proxy Tools** (~1 week)
   - Cross-project tools (list all issues, query knowledge base)
   - Proxy through HQ

3. **Phase 3 — Skill Sharing** (~1-2 weeks)
   - Shared skill storage in launchpad-state repo
   - Daemon sync, SDK skill directory integration

**What to Defer**
- **HQ as MCP proxy** — breaks "HQ only aggregates" principle, adds HQ to critical path of tool execution
- **RAG/embedding search** — requires vector DB, contradicts "no database" architecture decision

#### Issue Created
GitHub Issue #73 filed with comprehensive analysis across 5 areas:
- MCP servers (local/remote)
- Custom tools (definition, parameters)
- Skills/knowledge sharing
- System prompt injection
- Competitive landscape (Claude Projects, ChatGPT Custom Instructions)

#### Next Steps
Phase 1 is ready to proceed when priorities allow. Builds naturally on Issue #60 (MCP injection) and Issue #72 (workflow system — coordinator sessions would benefit from context injection). No code changes in this research phase.

## Frontend Architecture Decisions (Brand)

### 2026-03-21: SRP Refactor — Barrel Re-export Pattern for Hook Splitting
**By:** Brand (Frontend Dev) — Issue #76

Split `hooks.ts` (1514 lines, 50+ hooks) into 6 domain-specific files, keeping `hooks.ts` as a barrel re-export. Zero consumer changes needed — all imports from `../services/hooks.js` continue to work.

**Domain files:** dashboard-hooks, daemon-hooks, session-hooks, conversation-hooks, tunnel-hooks, settings-hooks.

**Alternatives rejected:**
- Direct imports to domain files — requires ~30 component changes for zero benefit
- Namespace exports — adds verbosity without modularity gain

### 2026-03-21: SRP Refactor — ConversationMessageRenderers as Single File
**By:** Brand (Frontend Dev) — Issue #76

All 15+ memo'd message renderers stay in one `ConversationMessageRenderers.tsx` (675 lines) rather than one file per renderer. Rationale: shared concern (rendering `ConversationEntry` variants), shared prop type, only `ConversationMessage` dispatcher is consumed externally. 15 separate files would add overhead without real modularity benefit.

### 2026-03-21: SRP Refactor — Cross-Domain Hook Dependencies
**By:** Brand (Frontend Dev) — Issue #76

`conversation-hooks.ts` imports from `session-hooks.ts` (useSessionMessages, useSessionTools, useAggregatedSession). This one-way dependency is intentional — conversation entries are derived from session data. Dependency direction: conversation → session (never reverse).

## Feature Decisions

### 2025-07-24: In-Memory Event Persistence for Copilot Sessions
**By:** Romilly (Server/Aggregator)  
**Status:** Implemented (commit 52b7d8b)

#### Context
Raw session events (tool calls, model changes, lifecycle events) were only available via live WebSocket. Clients that disconnected lost the full timeline.

#### Decision
- All SDK session events and tool invocations are stored in-memory per session (capped at 10,000 events)
- A paginated REST endpoint (`GET /api/copilot/aggregated/sessions/:sessionId/events`) allows clients to reconstruct the full event timeline on reconnect
- Events are stored as-is (raw format) — the client already knows how to process them
- Backward pagination via `before` (ISO timestamp cursor), chronological order within each page

#### Implications
- Memory usage increases proportionally with active sessions × events. The 10K cap keeps this bounded (~5–10MB per active session worst case)
- Clients can now re-attach and load historical events instead of only seeing live events from the moment of connection
- The `StoredEvent` type is exported from the aggregator for any future consumers

### 2026-03-22: Event Processing Extraction & Windowed Rendering
**By:** Brand (Frontend Dev)  
**Status:** Implemented (commit 57d821d)

#### Context
The ~400-line WebSocket event handler in `conversation-hooks.ts` was the only path for converting SDK events into `ConversationEntry[]`. When a client re-attached to a session, only basic REST messages were available — all rich events (tool calls, intents, subagent activity) were lost.

#### Decision
1. **Extracted event processing** into `src/client/services/event-processor.ts` with a dual-mode processor:
   - `processSessionEvent()` — handles one event with `"live"` or `"batch"` mode
   - `processEventBatch()` — replays an array of historical events into entries
   - Both modes share the same `EventProcessorRefs` cross-event state

2. **New REST hook `useSessionEvents()`** — uses TanStack `useInfiniteQuery` with reverse cursor pagination against `GET /api/copilot/aggregated/sessions/:id/events`. Gracefully degrades to empty when endpoint isn't available yet.

3. **Historical events are authoritative** — when loaded, REST messages only fill timestamps BEFORE the events coverage. This prevents duplicates without complex dedup.

4. **Windowed rendering** — `renderCount` approach (render from tail of entries array). Scroll-up expands window; when all loaded entries are shown and `hasMore` is true, fetches older events from API.

5. **Scroll-to-bottom button** — appears when user scrolls up and new messages arrive. Shows count of new messages.

#### Impact
- `conversation-hooks.ts` dropped from ~920 to ~390 lines
- Event processing is now testable independently of React
- Re-attaching clients will see full event history when Romilly's endpoint ships
- No changes to existing rendering — `ConversationEntry` type unchanged

### 2026-03-22: Copilot CLI Session Attach Strategy
**By:** TARS (Daemon/SDK)  
**Status:** Proposal (needs Arjen review)

#### Context
Arjen asked whether our daemon could attach to or observe Copilot CLI sessions already running in the devcontainer terminal.

#### Findings
The SDK already supports this. `client.listSessions()` discovers all sessions (including terminal CLI sessions) from the shared `~/.copilot/session-state/` directory. `client.resumeSession(id)` works cross-client. The SDK also supports `cliUrl` for connecting multiple clients to a shared TCP server.

#### Recommended Approach
**Phase 1 (immediate):** Classify sessions from `listSessions()` as "daemon-managed" vs "external". Expose external sessions in HQ with metadata. Allow resuming them.

**Phase 2 (if needed):** Tail `events.jsonl` for live read-only observation of active terminal sessions.

**Phase 3 (if needed):** Shared CLI server via TCP for full bidirectional integration.

#### Impact
- No breaking changes — additive only
- Minimal code changes for Phase 1 (classification + UI)
- Full report: `COPILOT_CLI_RESEARCH.md`

#### Decision Needed
Which phase(s) to pursue and priority relative to other work.
