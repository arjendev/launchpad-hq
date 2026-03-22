# TARS — Daemon & SDK Specialist Context

## Core Context

### Architecture

- **Daemon entry:** `src/cli.ts` routes `--daemon` → `startDaemon()`, else → HQ server. Dynamic imports isolate deps.
- **Daemon modules:** `src/daemon/` — `config.ts`, `client.ts` (WS with auto-reconnect + exponential backoff 1s→30s), `state.ts`, `index.ts`, `message-router.ts`, `preview-manager.ts`
- **MessageRouter** (`src/daemon/message-router.ts`): Single `client.on('message')` entry point. Constructor-injected deps: copilot, cliSessions, coordinator, issueDispatcher, previewManager.
- **CopilotManager** (`src/daemon/copilot/manager.ts`): Uses `CopilotClient` directly via dynamic `import('@github/copilot-sdk')`. No adapter layer — SDK types are the wire types.
- **Extracted modules:** `ElicitationRelay` (timeout + pending map), `AgentResolver` (catalog + fuzzy match + select/deselect), `PreviewManager` (detection + retry + handler lifecycle).
- **Server-side aggregator:** `src/server/copilot-aggregator/` — aggregates sessions from all daemons, uses tombstone Set to prevent resurrection from stale polls.
- **Shared code:** `src/shared/` — protocol types, auth, constants. `SendToHq` type lives in `src/shared/protocol.ts`, imported by all daemon modules.
- **Fastify plugin chain:** `github-auth` → `state` → `api-cache` → routes. All use `fastify-plugin` (fp) with explicit `dependencies`.

### SDK Quirks

- **Session persistence:** SDK sessions need at least one message sent to persist on disk. `session.disconnect()` releases memory but keeps disk data. `session.abort()` + `session.destroy()` do NOT remove from SDK registry — must call `client.deleteSession(sessionId)`.
- **Agent not persisted on resume:** `customAgents` must be re-injected on every `create`/`resume` call. Agent selection via `session.rpc.agent.select()` / `deselect()` must be re-applied after resume.
- **Session status is eventually consistent:** Comes from events (`assistant.streaming_delta`, `session.shutdown`, etc.), not metadata polls. `SessionMetadata` has no `state` field.
- **SDK event names use underscores:** `tool.execution_start`, `assistant.streaming_delta`, `session.shutdown`. Forwarded as-is to HQ — no mapping layer.
- **SDK timestamp polymorphism:** Can be string, Date, or number. Use `toEpochMs()` helper in aggregator.
- **SDK import:** `await import('@github/copilot-sdk')` with graceful degradation — daemon starts fine without copilot if SDK CLI not in PATH.
- **SDK bug:** `session.js` imports `vscode-jsonrpc/node` without `.js` extension (ESM issue). `scripts/patch-sdk.js` (postinstall) fixes it.
- **RPC shape:** `session.rpc.mode.get()`/`.set({mode})`, `session.rpc.plan.read()`/`.update({content})`/`.delete()`, `session.rpc.agent.select()`/`.deselect()`, `session.setModel(model)`, `client.listModels()`.
- **Request-response correlation:** `getMode`/`getPlan` use `requestId`. Fire-and-forget: `setModel`/`setMode`/`updatePlan`/`deletePlan`.

### Patterns

- **SendToHq:** `type SendToHq = (msg: DaemonToHqMessage) => void` — defined once in `src/shared/protocol.ts`, passed to all daemon modules.
- **ElicitationRelay:** Callback injection (`isSessionActive`, `sendToSession`, `sendSessionError`) keeps it decoupled from CopilotManager internals.
- **AgentResolver:** Scans `.github/agents/*.agent.md` YAML frontmatter. Always includes `builtin:default`. Catalog advertised in `register.agentCatalog` AND via live `copilot-agent-catalog` message.
- **PreviewManager:** Port auto-detection: devcontainer.json `forwardPorts` → package.json script heuristics → port scan. Periodic re-detection (30s). HTTP proxy with base64 body encoding, WS relay via channelId map for HMR.
- **EventEmitter error listener:** ALL EventEmitter subclasses MUST register a default `error` listener in constructor. Prevents unhandled crash.
- **PTY environment:** `buildShellEnv()` merges `process.env` with defaults (TERM, SHELL, HOME, PATH, LANG). Always spawn with `['-l']` for login shell in backgrounded daemons.
- **DI for testing:** Manager accepts `client?: any` constructor option. Tests use duck-typed mock client/session — no `vi.mock` needed. `TestSdkSession.dispatch()` creates mock `SessionEvent`.
- **Graceful degradation:** Daemon always starts. SDK unavailable → warn + continue. Docker unavailable → `{ dockerAvailable: false }`. Tunnel CLI missing → log + skip.

### Protocol

- **Types:** `src/shared/protocol.ts` — discriminated unions on `type` field. `DaemonToHqMessage` and `HqToDaemonMessage` unions.
- **Auth:** Challenge-response with nonce. `generateDaemonToken()` (crypto.randomBytes(32).hex), `validateDaemonToken()` (timingSafeEqual). 15s handshake timeout (`WS_CLOSE_AUTH_TIMEOUT = 4002`).
- **Constants:** `src/shared/constants.ts` — heartbeat 15s, reconnect backoff 1s→30s, daemon WS path `/ws/daemon`.
- **DaemonEventMap:** Typed event bus. DaemonRegistry extends DaemonEventBus. All events (copilot, preview, terminal) have typed payloads. No `as never` casts.
- **Preview protocol:** `preview-config`, `preview-proxy-request/response`, `preview-ws-open/data/close`.
- **Terminal types:** `ws/types.ts` = browser→HQ (has `daemonId`), `shared/protocol.ts` = HQ→daemon (has `projectId` + `sessionId`). Intentionally distinct.
- **Token redaction:** `process.title = 'launchpad-hq daemon'` after reading `--token` in cli.ts.

### Build & Test

- **Build:** `npm run build` (full), `npm run build:server` (server only)
- **Test:** `npm run test` (all ~1165 tests), supports focused vitest runs
- **Typecheck:** `npx tsc --noEmit` (server tsconfig includes `src/daemon/` and `src/shared/`)
- **Decisions:** `.squad/decisions.md` is the authoritative decisions file

## Learnings

### Copilot CLI Session Attach Research (2026-03-22)

- **SDK supports cross-client session resume:** `client.listSessions()` discovers ALL sessions from `~/.copilot/session-state/` regardless of which client created them. `client.resumeSession(id)` works for any session on disk.
- **Three connection modes:** stdio (default, private), TCP (`useStdio: false, port: N`), and external server (`cliUrl: "host:port"`). TCP mode enables session sharing between multiple SDK clients.
- **Session persistence is file-based:** Sessions stored at `~/.copilot/session-state/{uuid}/` with `workspace.yaml`, `events.jsonl` (can be 100MB+), `session.db` (SQLite), `plan.md`, and `inuse.{PID}.lock` advisory locks.
- **Global session store:** `~/.copilot/session-store.db` is a shared SQLite database indexing all sessions.
- **Daemon already discovers external sessions:** `pollSessions()` calls `listSessions()` every 30s, returns sessions from terminal CLI too. Just needs UI/protocol to expose them.
- **cliUrl option is key:** `CopilotClient({ cliUrl: "localhost:PORT" })` connects to existing server without spawning. Combined with `--headless --port N`, enables shared server architecture.
- **Lock files indicate active sessions:** `inuse.{PID}.lock` files in session dirs map PIDs to sessions. Multiple PIDs can hold locks simultaneously.
- **Research report:** Full findings in `COPILOT_CLI_RESEARCH.md` at repo root.

### Cross-Agent Notes (2026-03-22)

#### Romilly's Event Persistence Infrastructure (commit 52b7d8b)
- Aggregator now stores all raw session events in-memory (`eventLogs: Map<string, StoredEvent[]>`)
- Capped at 10,000 events per session (~5–10MB worst case)
- REST endpoint: `GET /api/copilot/aggregated/sessions/:sessionId/events?before=ISO&limit=N`
- Backward pagination via ISO timestamp cursor; chronological order within pages
- Foundation for Phase 1 of CLI attach strategy: external sessions will be discoverable + resumable via same API

#### Brand's Event Processing Integration (commit 57d821d)
- Client-side `useSessionEvents()` hook consumes Romilly's REST API with reverse cursor pagination
- Dual-mode event processor supports replaying historical events on client re-attachment
- Windowed rendering with scroll-to-bottom for better UX during pagination
- Ready to integrate Phase 1 external session discovery once approved
