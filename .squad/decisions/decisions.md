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
