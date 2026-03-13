# Copilot SDK Interface Audit & Integration Redesign Proposal

**Author:** Cooper (Lead/Architect)  
**Date:** 2026-03-14  
**SDK version:** `@github/copilot-sdk` (protocol v3)  
**Requested by:** Arjen

---

## A) Complete SDK Surface Map

### A1. CopilotClient — Methods & Properties

| # | SDK Method/Property | Our Status | Notes |
|---|---|---|---|
| 1 | `constructor(options?: CopilotClientOptions)` | ✅ Used | Via `SdkCopilotAdapter.start()` |
| 2 | `start(): Promise<void>` | ✅ Used | Called in adapter start() |
| 3 | `stop(): Promise<Error[]>` | ✅ Used | Called in adapter stop() |
| 4 | `forceStop(): Promise<void>` | ✅ Used | Fallback in adapter stop() |
| 5 | `createSession(config: SessionConfig): Promise<CopilotSession>` | ⚠️ Partial | We pass limited config (see A3) |
| 6 | `resumeSession(sessionId, config: ResumeSessionConfig)` | ⚠️ Partial | Same config limitations |
| 7 | `getState(): ConnectionState` | ✅ Used | Mapped to adapter.state |
| 8 | `ping(message?)` | ❌ Gap | Not exposed anywhere |
| 9 | `getStatus(): Promise<GetStatusResponse>` | ❌ Gap | Version/protocol info not surfaced |
| 10 | `getAuthStatus(): Promise<GetAuthStatusResponse>` | ❌ Gap | Auth state not surfaced |
| 11 | `listModels(): Promise<ModelInfo[]>` | ❌ Gap | Model list not exposed |
| 12 | `getLastSessionId(): Promise<string \| undefined>` | ✅ Used | Exposed via adapter |
| 13 | `deleteSession(sessionId)` | ✅ Used | Exposed via adapter |
| 14 | `listSessions(filter?: SessionListFilter)` | ⚠️ Partial | Filter param not passed through |
| 15 | `getForegroundSessionId()` | ❌ Gap | TUI mode not supported |
| 16 | `setForegroundSessionId(sessionId)` | ❌ Gap | TUI mode not supported |
| 17 | `on(eventType, handler)` — typed lifecycle | ❌ Gap | Session lifecycle events not wired |
| 18 | `on(handler)` — all lifecycle events | ❌ Gap | No client-level event forwarding |
| 19 | `rpc` (server-scoped RPC) | ❌ Gap | Entire RPC surface not exposed |

### A2. CopilotSession — Methods & Properties

| # | SDK Method/Property | Our Status | Notes |
|---|---|---|---|
| 1 | `sessionId: string` | ✅ Used | |
| 2 | `send(options: MessageOptions)` | ⚠️ Partial | We call `sendAndWait` instead; no fire-and-forget streaming |
| 3 | `sendAndWait(options, timeout?)` | ✅ Used | Wrapped in SdkCopilotSession.send() |
| 4 | `on(eventType, handler)` — typed events | ❌ Gap | We only use untyped `on(handler)` |
| 5 | `on(handler)` — all events | ✅ Used | With event mapping |
| 6 | `abort()` | ✅ Used | |
| 7 | `getMessages()` | ✅ Used | |
| 8 | `disconnect()` | ✅ Used | Called via destroy() |
| 9 | `destroy()` (deprecated) | ⚠️ Incorrect | Our CopilotSession interface uses `destroy()` not `disconnect()` |
| 10 | `registerTools(tools?)` | ❌ Gap | Done via config only |
| 11 | `registerPermissionHandler(handler?)` | ❌ Gap | Hardcoded to `approveAll` |
| 12 | `registerUserInputHandler(handler?)` | ❌ Gap | Not supported |
| 13 | `registerHooks(hooks?)` | ❌ Gap | Not supported |
| 14 | `workspacePath: string \| undefined` | ❌ Gap | Infinite session workspace not exposed |
| 15 | `rpc` (session-scoped RPC) | ❌ Gap | Entire session RPC surface not exposed |
| 16 | `setModel(model)` | ❌ Gap | Cannot change model mid-session |

### A3. SessionConfig — Fields We Pass Through

| SDK Config Field | Our Status | Notes |
|---|---|---|
| `model` | ✅ Forwarded | |
| `systemMessage` | ✅ Forwarded | We inject our own if none provided |
| `tools` | ✅ Forwarded | Plus HQ tools injected |
| `streaming` | ✅ Forwarded | |
| `onPermissionRequest` | ⚠️ Hardcoded | Always `approveAll` — not configurable |
| `sessionId` | ❌ Not forwarded | Cannot specify custom session ID |
| `clientName` | ❌ Not forwarded | Should be "launchpad-hq" |
| `reasoningEffort` | ❌ Not forwarded | |
| `configDir` | ❌ Not forwarded | |
| `availableTools` | ❌ Not forwarded | |
| `excludedTools` | ❌ Not forwarded | |
| `provider` | ❌ Not forwarded | BYOK not supported |
| `onUserInputRequest` | ❌ Not forwarded | User input not supported |
| `hooks` | ❌ Not forwarded | |
| `workingDirectory` | ❌ Not forwarded | Defaults to cwd |
| `mcpServers` | ❌ Not forwarded | |
| `customAgents` | ❌ Not forwarded | |
| `skillDirectories` | ❌ Not forwarded | |
| `disabledSkills` | ❌ Not forwarded | |
| `infiniteSessions` | ❌ Not forwarded | |

### A4. Session Events (35 distinct types from SDK)

| SDK Event Type | Our Protocol Coverage | Notes |
|---|---|---|
| `session.start` | ✅ Mapped | |
| `session.resume` | ❌ Gap | Not in our event type enum |
| `session.error` | ✅ Mapped | |
| `session.idle` | ✅ Mapped | |
| `session.title_changed` | ❌ Gap | |
| `session.info` | ❌ Gap | |
| `session.warning` | ❌ Gap | |
| `session.model_change` | ❌ Gap | |
| `session.mode_changed` | ❌ Gap | |
| `session.plan_changed` | ❌ Gap | |
| `session.workspace_file_changed` | ❌ Gap | |
| `session.handoff` | ❌ Gap | |
| `session.truncation` | ❌ Gap | |
| `session.snapshot_rewind` | ❌ Gap | |
| `session.shutdown` | ❌ Gap | Rich shutdown stats not captured |
| `session.context_changed` | ❌ Gap | |
| `session.usage_info` | ❌ Gap | |
| `session.compaction_start` | ❌ Gap | |
| `session.compaction_complete` | ❌ Gap | |
| `session.task_complete` | ❌ Gap | |
| `user.message` | ✅ Mapped | |
| `pending_messages.modified` | ❌ Gap | |
| `assistant.turn_start` | ❌ Gap | |
| `assistant.intent` | ❌ Gap | Great for UI status display |
| `assistant.reasoning` | ✅ Mapped (as `assistant.reasoning`) | |
| `assistant.reasoning_delta` | ✅ Mapped (as `assistant.reasoning.delta`) | |
| `assistant.streaming_delta` | ⚠️ Wrong mapping | Mapped to `assistant.message.delta` — semantically wrong |
| `assistant.message` | ✅ Mapped | |
| `assistant.message_delta` | ✅ Mapped (as `assistant.message.delta`) | |
| `assistant.turn_end` | ❌ Gap | |
| `assistant.usage` | ❌ Gap | Token/cost data not forwarded |
| `abort` | ❌ Gap | |
| `tool.user_requested` | ❌ Gap | |
| `tool.execution_start` | ✅ Mapped (as `tool.executionStart`) | |
| `tool.execution_partial_result` | ❌ Gap | Live tool output |
| `tool.execution_progress` | ❌ Gap | |
| `tool.execution_complete` | ✅ Mapped (as `tool.executionComplete`) | |
| `skill.invoked` | ❌ Gap | |
| `subagent.started` | ❌ Gap | |
| `subagent.completed` | ❌ Gap | |
| `subagent.failed` | ❌ Gap | |
| `subagent.selected` | ❌ Gap | |
| `subagent.deselected` | ❌ Gap | |
| `hook.start` | ❌ Gap | |
| `hook.end` | ❌ Gap | |
| `system.message` | ❌ Gap | |
| `permission.requested` | ❌ Gap | We auto-approve; no UI |
| `permission.completed` | ❌ Gap | |
| `user_input.requested` | ❌ Gap | |
| `user_input.completed` | ❌ Gap | |
| `elicitation.requested` | ❌ Gap | |
| `elicitation.completed` | ❌ Gap | |
| `external_tool.requested` | ❌ Gap | |
| `external_tool.completed` | ❌ Gap | |
| `command.queued` | ❌ Gap | |
| `command.completed` | ❌ Gap | |
| `exit_plan_mode.requested` | ❌ Gap | |
| `exit_plan_mode.completed` | ❌ Gap | |

### A5. Server-Scoped RPC (`client.rpc.*`)

| RPC Method | Our Status | Notes |
|---|---|---|
| `rpc.ping(params)` | ❌ Gap | Health check |
| `rpc.models.list()` | ❌ Gap | Model discovery |
| `rpc.tools.list(params)` | ❌ Gap | Built-in tool discovery |
| `rpc.account.getQuota()` | ❌ Gap | Quota/billing info |

### A6. Session-Scoped RPC (`session.rpc.*`)

| RPC Method | Our Status | Notes |
|---|---|---|
| `rpc.model.getCurrent()` | ❌ Gap | |
| `rpc.model.switchTo({modelId})` | ❌ Gap | |
| `rpc.mode.get()` | ❌ Gap | interactive/plan/autopilot |
| `rpc.mode.set({mode})` | ❌ Gap | |
| `rpc.plan.read()` | ❌ Gap | |
| `rpc.plan.update({content})` | ❌ Gap | |
| `rpc.plan.delete()` | ❌ Gap | |
| `rpc.workspace.listFiles()` | ❌ Gap | |
| `rpc.workspace.readFile({path})` | ❌ Gap | |
| `rpc.workspace.createFile({path, content})` | ❌ Gap | |
| `rpc.fleet.start({prompt?})` | ❌ Gap | |
| `rpc.agent.list()` | ❌ Gap | |
| `rpc.agent.getCurrent()` | ❌ Gap | |
| `rpc.agent.select({name})` | ❌ Gap | |
| `rpc.agent.deselect()` | ❌ Gap | |
| `rpc.compaction.compact()` | ❌ Gap | |
| `rpc.tools.handlePendingToolCall(...)` | ❌ Gap | |
| `rpc.permissions.handlePendingPermissionRequest(...)` | ❌ Gap | |

### A7. Lifecycle Events (Client-Level)

| Event Type | Our Status | Notes |
|---|---|---|
| `session.created` | ❌ Gap | |
| `session.deleted` | ❌ Gap | |
| `session.updated` | ❌ Gap | |
| `session.foreground` | ❌ Gap | TUI mode |
| `session.background` | ❌ Gap | TUI mode |

---

## B) Gap Analysis — Ordered by Importance

### Critical Gaps (blocks core use cases)

1. **No model listing** — UI can't show a model picker. `listModels()` and `rpc.models.list()` both available.
2. **No auth status** — Can't tell user if they're authenticated or why things fail. `getAuthStatus()` available.
3. **No mode control** — Can't switch between interactive/plan/autopilot. `rpc.mode.get/set` available.
4. **No `send()` (fire-and-forget)** — We only expose `sendAndWait()`, blocking the caller for up to 5 minutes. The UI needs non-blocking send + streaming events.
5. **Permission handler hardcoded** — `approveAll` means no user consent flow. For "deep introspection" and "takeover" features, the UI needs to present permission requests.
6. **No user input handler** — Agent can't ask the user questions. Blocks conversational flow.

### High-Value Gaps (significant for UX)

7. **`assistant.intent`** — Short status text ("Exploring codebase", "Running tests"). Perfect for the session card in the UI.
8. **`assistant.usage` / `session.usage_info`** — Token counts, costs, quota. Users need this for cost awareness.
9. **`session.shutdown`** — Contains code change metrics (lines added/removed, files modified) and per-model usage. Gold for the dashboard.
10. **`session.title_changed`** — Auto-generated session titles. Currently we have no titles.
11. **`setModel(model)`** — Cannot change model mid-conversation.
12. **Plan RPC** (`plan.read/update/delete`) — Plan mode is a key Copilot feature. We should expose it.
13. **Session lifecycle events** (`client.on`) — Real-time notifications when sessions are created/deleted/updated externally.
14. **`session.handoff`** — Remote-to-local handoff. Relevant for our devcontainer use case.
15. **`clientName`** not set — We should identify as "launchpad-hq" in User-Agent.

### Medium Gaps (nice-to-have)

16. **Agent selection** (`agent.list/select/deselect`) — Custom agent support.
17. **`tool.execution_partial_result`** — Live streaming tool output (think: watching bash run in real time).
18. **Compaction events** — `session.compaction_start/complete` for UI progress indicators.
19. **Fleet mode** (`rpc.fleet.start`) — Multi-agent orchestration.
20. **Workspace files** (`workspace.listFiles/readFile/createFile`) — Session artifacts.
21. **Built-in tool listing** (`rpc.tools.list`) — Show users what tools are available.
22. **Account quota** (`rpc.account.getQuota`) — Show remaining usage.
23. **`session.info` / `session.warning`** — Informational/warning messages.
24. **Session list filter** — Filter by repository, branch, cwd.
25. **Sub-agent events** — `subagent.started/completed/failed` for visibility into multi-agent work.

### Low Priority / Skip

26. **Foreground/background TUI** — We're building our own UI, not wrapping the TUI. **Skip.**
27. **`session.snapshot_rewind`** — Internal undo mechanism. **Skip** (for now).
28. **`hook.start/hook.end`** — Internal hook lifecycle. **Skip.**
29. **`elicitation.*`** — Low-usage feature. **Skip** (for now).
30. **`exit_plan_mode.*`** — Internal plan mode transitions. **Skip** (events already captured by `mode_changed`).
31. **`command.queued/completed`** — Internal command queue. **Skip.**

---

## C) Redesign Proposal

### C1. Session Events — What to Forward

| SDK Event | Layer | Rationale |
|---|---|---|
| `session.start` | **Forward to HQ** → **Expose to UI** | Session timeline |
| `session.resume` | **Forward to HQ** → **Expose to UI** | Session timeline |
| `session.error` | **Forward to HQ** → **Expose to UI** | Error display |
| `session.idle` | **Forward to HQ** → **Expose to UI** | "Done" indicator |
| `session.title_changed` | **Forward to HQ** → **Expose to UI** | Session card title |
| `session.info` | **Forward to HQ** → **Expose to UI** | Timeline info messages |
| `session.warning` | **Forward to HQ** → **Expose to UI** | Warning display |
| `session.model_change` | **Forward to HQ** → **Expose to UI** | Model indicator |
| `session.mode_changed` | **Forward to HQ** → **Expose to UI** | Mode indicator |
| `session.plan_changed` | **Forward to HQ** → **Expose to UI** | Plan mode UI |
| `session.workspace_file_changed` | **Forward to HQ** | Workspace file tracking |
| `session.handoff` | **Forward to HQ** → **Expose to UI** | Handoff notification |
| `session.truncation` | **Forward to HQ** | Context window diagnostics |
| `session.snapshot_rewind` | **Skip** | Internal |
| `session.shutdown` | **Forward to HQ** → **Expose to UI** | Rich session summary |
| `session.context_changed` | **Forward to HQ** | Internal tracking |
| `session.usage_info` | **Forward to HQ** → **Expose to UI** | Token usage gauge |
| `session.compaction_start` | **Forward to HQ** → **Expose to UI** | Progress indicator |
| `session.compaction_complete` | **Forward to HQ** → **Expose to UI** | Compaction stats |
| `session.task_complete` | **Forward to HQ** → **Expose to UI** | Task completion |
| `user.message` | **Forward to HQ** → **Expose to UI** | Chat timeline |
| `pending_messages.modified` | **Daemon-only** | Internal queue state |
| `assistant.turn_start` | **Forward to HQ** → **Expose to UI** | Turn boundary |
| `assistant.intent` | **Forward to HQ** → **Expose to UI** | Status display |
| `assistant.reasoning` | **Forward to HQ** → **Expose to UI** | Reasoning block |
| `assistant.reasoning_delta` | **Forward to HQ** → **Expose to UI** | Streaming reasoning |
| `assistant.streaming_delta` | **Daemon-only** | Low-level byte counter; not useful for UI |
| `assistant.message` | **Forward to HQ** → **Expose to UI** | Chat timeline |
| `assistant.message_delta` | **Forward to HQ** → **Expose to UI** | Streaming message |
| `assistant.turn_end` | **Forward to HQ** → **Expose to UI** | Turn boundary |
| `assistant.usage` | **Forward to HQ** → **Expose to UI** | Token/cost tracking |
| `abort` | **Forward to HQ** → **Expose to UI** | Abort confirmation |
| `tool.user_requested` | **Forward to HQ** → **Expose to UI** | Tool invocation tracking |
| `tool.execution_start` | **Forward to HQ** → **Expose to UI** | Tool timeline |
| `tool.execution_partial_result` | **Forward to HQ** → **Expose to UI** | Live tool output |
| `tool.execution_progress` | **Forward to HQ** → **Expose to UI** | Progress messages |
| `tool.execution_complete` | **Forward to HQ** → **Expose to UI** | Tool timeline |
| `skill.invoked` | **Forward to HQ** → **Expose to UI** | Skill tracking |
| `subagent.started` | **Forward to HQ** → **Expose to UI** | Multi-agent visibility |
| `subagent.completed` | **Forward to HQ** → **Expose to UI** | Multi-agent visibility |
| `subagent.failed` | **Forward to HQ** → **Expose to UI** | Error display |
| `subagent.selected/deselected` | **Forward to HQ** → **Expose to UI** | Agent switching |
| `hook.start/hook.end` | **Skip** | Internal lifecycle |
| `system.message` | **Forward to HQ** | System prompt tracking |
| `permission.requested` | **Forward to HQ** → **Expose to UI** | Permission consent UI |
| `permission.completed` | **Forward to HQ** → **Expose to UI** | Permission result |
| `user_input.requested` | **Forward to HQ** → **Expose to UI** | Ask-user UI |
| `user_input.completed` | **Forward to HQ** → **Expose to UI** | User response |
| `elicitation.*` | **Skip** | Low priority |
| `external_tool.*` | **Forward to HQ** → **Expose to UI** | External tool tracking |
| `command.*` | **Skip** | Internal queue |
| `exit_plan_mode.*` | **Skip** | Covered by mode_changed |

### C2. Client Methods — What to Expose

| SDK Method | Layer | Implementation Notes |
|---|---|---|
| `start()` | **Daemon-only** | Already works. No change. |
| `stop()` / `forceStop()` | **Daemon-only** | Already works. No change. |
| `createSession(config)` | **Forward to HQ** → **Expose to UI** | Pass full SessionConfig through. |
| `resumeSession(id, config)` | **Forward to HQ** → **Expose to UI** | Pass full ResumeSessionConfig through. |
| `getState()` | **Forward to HQ** → **Expose to UI** | Already works. |
| `ping()` | **Forward to HQ** | Health check endpoint on HQ REST API. |
| `getStatus()` | **Forward to HQ** → **Expose to UI** | CLI version display. |
| `getAuthStatus()` | **Forward to HQ** → **Expose to UI** | Auth indicator in UI. |
| `listModels()` | **Forward to HQ** → **Expose to UI** | Model picker in UI. |
| `getLastSessionId()` | **Forward to HQ** | Already works. |
| `deleteSession(id)` | **Forward to HQ** → **Expose to UI** | Already works. |
| `listSessions(filter?)` | **Forward to HQ** → **Expose to UI** | Add filter support. |
| `getForegroundSessionId()` | **Skip** | TUI-only. |
| `setForegroundSessionId()` | **Skip** | TUI-only. |
| `on(lifecycle events)` | **Forward to HQ** → **Expose to UI** | Real-time session list updates. |

### C3. Session Methods — What to Expose

| SDK Method | Layer | Implementation Notes |
|---|---|---|
| `send(options)` | **Forward to HQ** → **Expose to UI** | Non-blocking send + streaming. Replace `sendAndWait`. |
| `sendAndWait(options, timeout?)` | **Daemon-only** | Keep for internal use (e.g., HQ-initiated simple commands). |
| `on(handler)` | **Forward to HQ** → **Expose to UI** | Already works. Stop re-mapping event names. |
| `abort()` | **Forward to HQ** → **Expose to UI** | Already works. |
| `getMessages()` | **Forward to HQ** → **Expose to UI** | Already works. |
| `disconnect()` | **Daemon-only** | Internal lifecycle. |
| `setModel(model)` | **Forward to HQ** → **Expose to UI** | Model switching from UI. |
| `registerTools()` | **Daemon-only** | Config-time only. |
| `registerPermissionHandler()` | **Daemon-only** | But handler should forward to UI. |
| `registerUserInputHandler()` | **Daemon-only** | But handler should forward to UI. |
| `registerHooks()` | **Daemon-only** | Future: hook into tool use for policies. |
| `workspacePath` | **Forward to HQ** | Expose as session metadata. |

### C4. Session RPC — What to Expose

| RPC Method | Layer | Implementation Notes |
|---|---|---|
| `rpc.model.getCurrent()` | **Forward to HQ** → **Expose to UI** | Model indicator. |
| `rpc.model.switchTo()` | **Forward to HQ** → **Expose to UI** | Model picker action. |
| `rpc.mode.get()` | **Forward to HQ** → **Expose to UI** | Mode indicator. |
| `rpc.mode.set()` | **Forward to HQ** → **Expose to UI** | Mode switcher. |
| `rpc.plan.read()` | **Forward to HQ** → **Expose to UI** | Plan viewer. |
| `rpc.plan.update()` | **Forward to HQ** → **Expose to UI** | Plan editor. |
| `rpc.plan.delete()` | **Forward to HQ** → **Expose to UI** | Plan management. |
| `rpc.workspace.listFiles()` | **Forward to HQ** → **Expose to UI** | File browser. |
| `rpc.workspace.readFile()` | **Forward to HQ** → **Expose to UI** | File viewer. |
| `rpc.workspace.createFile()` | **Forward to HQ** | Internal; less likely from UI. |
| `rpc.fleet.start()` | **Forward to HQ** → **Expose to UI** | Fleet mode button. |
| `rpc.agent.list()` | **Forward to HQ** → **Expose to UI** | Agent picker. |
| `rpc.agent.getCurrent()` | **Forward to HQ** → **Expose to UI** | Agent indicator. |
| `rpc.agent.select()` | **Forward to HQ** → **Expose to UI** | Agent picker action. |
| `rpc.agent.deselect()` | **Forward to HQ** → **Expose to UI** | Agent picker action. |
| `rpc.compaction.compact()` | **Forward to HQ** | Manual compaction trigger. |
| `rpc.tools.handlePendingToolCall()` | **Skip** | SDK handles internally via handlers. |
| `rpc.permissions.handlePendingPermissionRequest()` | **Skip** | SDK handles internally via handlers. |

### C5. Server RPC — What to Expose

| RPC Method | Layer | Implementation Notes |
|---|---|---|
| `rpc.ping()` | **Forward to HQ** | Health check. |
| `rpc.models.list()` | **Forward to HQ** → **Expose to UI** | Identical to `listModels()`. |
| `rpc.tools.list()` | **Forward to HQ** → **Expose to UI** | Tool discovery. |
| `rpc.account.getQuota()` | **Forward to HQ** → **Expose to UI** | Quota display. |

---

## D) Architecture Recommendation

### The Adapter Should NOT Exist as a Separate Layer

**Current state:** We have a 3-layer sandwich:
```
SDK types → adapter.ts (our interface) → sdk-adapter.ts (implementation) → manager.ts
```

**Problems with this:**
1. The adapter redefines types the SDK already exports (`SessionConfig`, `CopilotSession`, `ToolDefinition`)
2. It uses `any` everywhere because it hides the SDK's actual types
3. The event mapping layer (`SDK_TO_PROTOCOL_EVENT`) renames events unnecessarily — the SDK event names are the canonical names
4. Our `CopilotSessionEvent` flattens rich typed union events into `{ type: string, data: Record<string, unknown> }` — throwing away all type safety
5. The adapter only exposes ~15% of the SDK surface, making the rest unreachable

### Recommended Architecture

**Delete the adapter layer. Have the manager work directly with SDK types.**

```
SDK types (source of truth)
    ↓
CopilotManager (uses SDK directly, typed)
    ↓
Wire protocol (daemon → HQ)
    ↓
HQ REST/WebSocket API
    ↓
React client
```

**Specifically:**

1. **Import SDK types directly** in manager.ts. No re-declarations.
   ```ts
   import { CopilotClient, CopilotSession, type SessionConfig, type SessionEvent } from '@github/copilot-sdk';
   ```

2. **Forward SDK events as-is** over the wire. Don't rename them. Don't flatten them. The SDK's `SessionEvent` union type IS the event schema. Send it verbatim as JSON.
   ```ts
   // Instead of mapping "assistant.message_delta" → "assistant.message.delta"
   // just send the SDK event unchanged
   session.on((event) => {
     sendToHq({ type: 'copilot-session-event', sessionId, event });
   });
   ```

3. **Extend the wire protocol** to pass through SDK types:
   - `SessionConfig` over the wire (minus handler functions which get injected daemon-side)
   - `SessionEvent` over the wire (the full union type, not our flattened version)
   - `SessionMetadata` over the wire
   - `ModelInfo[]` over the wire
   - `GetAuthStatusResponse` over the wire

4. **The only daemon-side logic should be:**
   - Starting/stopping the SDK client (lifecycle)
   - Injecting HQ tools + system message into session configs
   - Injecting permission/user-input handlers that forward to HQ for UI consent
   - Forwarding events to HQ
   - Responding to HQ commands by calling SDK methods

5. **The shared protocol becomes a thin message envelope**, not a type redefinition layer:
   ```ts
   // Wire messages are just envelopes around SDK types
   interface CopilotSessionEventMessage {
     type: 'copilot-session-event';
     sessionId: string;
     event: import('@github/copilot-sdk').SessionEvent; // SDK type directly
   }
   ```

### What Gets Thinner

| Component | Before | After |
|---|---|---|
| `adapter.ts` | 94 lines of interface defs | **Deleted** |
| `sdk-adapter.ts` | 277 lines wrapping SDK | **Deleted** — manager imports SDK directly |
| `protocol.ts` (copilot types) | ~50 lines of re-declared types | ~10 lines of message envelopes using SDK types |
| `manager.ts` | 354 lines (via adapter) | Similar size but typed, no `any`, direct SDK calls |
| Event mapping | 5-line mapping table + lossy conversion | **Deleted** — pass-through |

### Risk Mitigation

- **"But what about testing?"** — Mock the SDK client directly. The SDK exports interfaces/types. Create a mock `CopilotClient` that implements the same surface. This is simpler than mocking our custom adapter interface, because there's one less abstraction to keep in sync.

- **"But what about SDK version changes?"** — The adapter doesn't protect us today. It's a thin wrapper that breaks whenever the SDK changes. With direct usage, TypeScript catches SDK API changes at compile time instead of at runtime (because of all the `any` casts).

- **"But what about the wire protocol?"** — The shared protocol just needs message envelopes. The event/type schemas are owned by the SDK. The client can import the same `@github/copilot-sdk` types for type checking — it's already an npm dependency.

### Incremental Migration Path

1. **Phase 1:** Stop renaming events. Use SDK event type strings directly in the protocol.
2. **Phase 2:** Replace `CopilotSessionEvent` in protocol with SDK's `SessionEvent` type.
3. **Phase 3:** Replace adapter `SessionConfig` with SDK's `SessionConfig` (minus handlers).
4. **Phase 4:** Delete adapter.ts and sdk-adapter.ts. Manager imports SDK directly.
5. **Phase 5:** Add missing SDK capabilities (models, auth, mode, plan, etc.) one by one.

---

## Summary

We currently expose **~15% of the SDK surface**. The adapter adds a lossy abstraction that hides type safety and blocks access to the remaining 85%. The simplest thing that works: delete the adapter, use SDK types as the source of truth, forward events unchanged, and let TypeScript do the validation instead of runtime `any` casts. The manager becomes a thin message-forwarding + handler-injection layer — which is exactly what it should be.
