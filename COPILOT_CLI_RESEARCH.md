# Copilot CLI Session Attach — Research Report

> **Author:** TARS (Daemon & SDK Specialist)  
> **Date:** 2026-03-22  
> **Requested by:** Arjen Kroezen

---

## 1. Executive Summary

**Can we attach to an already-running Copilot CLI session? Yes — and the SDK already supports it.**

The Copilot SDK (`@github/copilot-sdk@0.1.32`) communicates with a **Copilot CLI server** (`@github/copilot@1.0.5`) via JSON-RPC 2.0 over stdio or TCP. Sessions are persisted on disk by the CLI server at `~/.copilot/session-state/{sessionId}/`. The SDK provides `client.listSessions()` and `client.resumeSession(sessionId)` — these work across client instances because session state lives on the server, not in the SDK.

**Most promising approach: Shared CLI Server via TCP.** The SDK supports a `cliUrl` option to connect to an external CLI server over TCP. If the Copilot CLI ran in `--headless --port N` mode, multiple SDK clients could connect to the same server and share sessions. Today the CLI in the terminal uses `--headless --stdio` (our daemon spawns it this way too), but the architecture supports TCP.

**Immediate win: Session discovery via disk.** Even without a shared server, our daemon can already discover sessions created by the terminal CLI by calling `client.listSessions()` — the CLI server reads from the shared `~/.copilot/session-state/` directory. Our daemon already does this every 30 seconds via `pollSessions()`.

---

## 2. SDK Capabilities

### 2.1 CopilotClient Session Methods

From `node_modules/@github/copilot-sdk/dist/client.d.ts`:

| Method | Purpose | Cross-client? |
|--------|---------|---------------|
| `listSessions(filter?)` | List all sessions with optional cwd/branch/repo filter | ✅ Yes — reads from server disk |
| `getLastSessionId()` | Get most recently updated session | ✅ Yes |
| `resumeSession(sessionId, config)` | Attach to existing session | ✅ Yes — works for any session on disk |
| `createSession(config)` | Create new session | N/A |
| `deleteSession(sessionId)` | Delete session permanently | ✅ Yes |
| `getForegroundSessionId()` | TUI mode: get foreground session | ✅ Yes |
| `setForegroundSessionId(id)` | TUI mode: set foreground session | ✅ Yes |
| `listModels()` | List available models | N/A |

### 2.2 Session Metadata

```typescript
interface SessionMetadata {
  sessionId: string;
  startTime: Date;
  modifiedTime: Date;
  summary?: string;
  isRemote: boolean;
  context?: SessionContext;
}

interface SessionContext {
  cwd: string;
  gitRoot?: string;
  repository?: string;  // "owner/repo" format
  branch?: string;
}

interface SessionListFilter {
  cwd?: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
}
```

### 2.3 Three Connection Modes

The SDK supports three ways to connect to the CLI server:

#### Mode A: stdio (Default) — Current daemon mode
```
CopilotClient → spawn(copilot --headless --stdio) → JSON-RPC over stdin/stdout
```
- Each client spawns its own CLI server process
- Private: no other process can connect
- Our daemon uses this mode today

#### Mode B: TCP — Shared server potential
```
CopilotClient({ useStdio: false, port: 0 }) → spawn(copilot --headless --port N) → JSON-RPC over TCP
```
- CLI server prints `listening on port N` to stdout
- SDK connects via TCP socket
- **Multiple clients could share the same server** if they use `cliUrl`

#### Mode C: External Server — Connect to existing CLI
```
CopilotClient({ cliUrl: "localhost:3000" }) → connect via TCP to existing server
```
- No process spawning — connects to pre-existing server
- `cliUrl` formats: `"host:port"`, `"http://host:port"`, or just `"port"`
- **This is the key to session sharing**

### 2.4 Session Persistence Architecture

Sessions are persisted by the CLI server at `~/.copilot/session-state/{sessionId}/`:

```
~/.copilot/session-state/{uuid}/
├── workspace.yaml          # Session metadata (cwd, git info, timestamps)
├── events.jsonl            # Full conversation history (can be 100MB+)
├── session.db              # SQLite database (session state)
├── plan.md                 # Agent planning document
├── checkpoints/            # Compaction checkpoints
│   └── index.md
├── files/                  # Session-local files (paste content, etc.)
├── research/               # Research artifacts
├── rewind-snapshots/       # Git rewind points
├── inuse.{PID}.lock        # Lock files indicating which PIDs are attached
└── vscode.metadata.json    # VS Code integration metadata
```

**Lock files are critical:** `inuse.{PID}.lock` files indicate which process is currently attached to a session. Multiple PIDs can hold locks simultaneously (we observed `inuse.1579.lock`, `inuse.22779.lock`, `inuse.92563.lock` on the same session). Stale lock files from dead processes remain until cleaned up.

### 2.5 Global Session Store

A shared SQLite database at `~/.copilot/session-store.db` (5.6MB) provides cross-session indexing. This is shared across all CLI instances in the devcontainer.

---

## 3. Session Discovery

### 3.1 How Sessions Are Currently Discovered

Our daemon's `CopilotManager.pollSessions()` calls `client.listSessions()` every 30 seconds. This sends a `session.list` JSON-RPC request to the daemon's own CLI server process. The server scans `~/.copilot/session-state/` for session directories and returns their metadata.

**Critical finding:** Because all CLI server instances read from the same `~/.copilot/session-state/` directory, `listSessions()` returns ALL sessions — including those created by the terminal Copilot CLI or other SDK clients.

### 3.2 Running Copilot Processes in This Devcontainer

| PID | Process | Mode | Sessions |
|-----|---------|------|----------|
| 35928 | `/usr/local/bin/copilot` | Interactive terminal (pts/0) | Active Copilot CLI session |
| 92563 | `/usr/local/bin/copilot --resume` | Interactive terminal (pts/4) | Resumed session |
| 90544 | `@github/copilot/index.js --headless --stdio` | Daemon SDK (pts/3) | Daemon-managed sessions |
| 8832 | `/usr/local/bin/copilot` | Stopped (T state, old session) | Stale |

**Process chain for terminal CLI:**
```
bash → copilot (shell script) → copilotCLIShim.js → copilot (loader) → /usr/local/bin/copilot (server)
```

**Process chain for our daemon:**
```
daemon/index.ts → @github/copilot/index.js --headless --stdio → copilot (server)
```

### 3.3 Session Lock Files

The CLI server writes `inuse.{PID}.lock` files to indicate session ownership. Multiple processes can claim the same session. This is an advisory lock — the CLI doesn't enforce exclusive access.

### 3.4 Environment Variables

The Copilot CLI sets these when running:
- `COPILOT_RUN_APP=1` — indicates the app.js is loaded
- `COPILOT_LOADER_PID={pid}` — PID of the loader process
- `COPILOT_CLI=1` — CLI mode flag
- `COPILOT_CLI_BINARY_VERSION=1.0.5` — version

---

## 4. Viable Approaches (Ranked by Feasibility)

### Approach 1: SDK Session Resume (Easiest — Works Today) ⭐⭐⭐⭐⭐

**How:** Our daemon's SDK client calls `listSessions()` to discover all sessions (including terminal CLI sessions), then `resumeSession(sessionId)` to attach.

**Evidence:** 
- `getOrAttachSession()` in our manager already supports `requireKnownSession: false`
- `resumeSession()` sends `session.resume` RPC to the CLI server, which loads session from disk
- The CLI server reads from `~/.copilot/session-state/` shared by all instances

**Limitation:** Two independent CLI servers. Our daemon's server resumes the session from disk, but doesn't share the same in-memory state as the terminal CLI's server. Both servers can read the session's `events.jsonl`, but real-time event streaming only works within each server's own clients.

**What you get:**
- ✅ Full conversation history via `session.getMessages()`
- ✅ Session metadata (model, agent, cwd, summary)
- ✅ Ability to send new messages to the session
- ⚠️ No real-time event streaming from the terminal CLI's ongoing conversation
- ⚠️ Concurrent writes from two servers could cause conflicts

**Effort:** Minimal — mostly UI/protocol work to expose "external sessions" in HQ.

### Approach 2: Shared CLI Server via TCP ⭐⭐⭐⭐

**How:** Start one CLI server in `--headless --port N` mode. Both the daemon and terminal CLI connect to it via `cliUrl`.

**Evidence:**
- SDK supports `cliUrl: "localhost:PORT"` to connect to external server
- CLI server supports `--port N` flag (verified in SDK spawn code: `args.push("--port", this.options.port.toString())`)
- When `isExternalServer: true`, SDK skips spawning and just connects via TCP
- `connectViaTcp()` uses `new Socket().connect(port, host)`

**Architecture:**
```
┌──────────────┐     TCP      ┌─────────────────┐     TCP     ┌──────────────┐
│ Terminal CLI  │ ────────────►│  Shared Copilot  │◄────────── │   Daemon     │
│ (copilot)    │              │  Server (--port) │            │   (SDK)      │
└──────────────┘              └─────────────────┘            └──────────────┘
                                      │
                                      ▼
                              ~/.copilot/session-state/
```

**What you get:**
- ✅ Real-time event streaming across all clients
- ✅ Shared session state in memory
- ✅ Full API access (create, resume, list, send, abort)
- ✅ Tool calls, permissions, and elicitation handled centrally
- ⚠️ Requires changing how both daemon and terminal CLI start

**Challenge:** The terminal `copilot` command (interactive TUI) doesn't expose a `--port` flag for its server. The `--headless --port` combination is SDK-only. We'd need to:
1. Start a shared CLI server ourselves (via SDK with `useStdio: false`)
2. Have the terminal CLI connect to it (needs investigation — may not be supported by the TUI)

**Effort:** Medium — requires a shared server lifecycle manager.

### Approach 3: PTY/Terminal I/O Observation ⭐⭐⭐

**How:** Watch the terminal PTY where `copilot` is running to capture its output.

**Evidence:**
- Terminal CLI runs on `/dev/pts/0` (verified via `/proc/{pid}/fd`)
- PTY output contains the full conversation in rendered form
- Linux allows reading from PTYs with appropriate permissions

**What you get:**
- ✅ See what the user sees in real-time
- ✅ No SDK changes needed
- ⚠️ Raw terminal output (ANSI codes, TUI rendering) — needs parsing
- ⚠️ Can't send commands or interact programmatically
- ⚠️ Fragile — depends on terminal output format

**Effort:** High — would need a terminal output parser and wouldn't enable interaction.

### Approach 4: Events.jsonl File Watching ⭐⭐⭐

**How:** Watch `~/.copilot/session-state/{id}/events.jsonl` for real-time changes.

**Evidence:**
- `events.jsonl` is a newline-delimited JSON file with all session events
- Can be 100MB+ for long sessions (the active session's is 101MB)
- Updated in real-time as the CLI processes events

**What you get:**
- ✅ Real-time event stream by tailing the file
- ✅ Full conversation history
- ✅ Structured JSON events (no parsing needed)
- ⚠️ Read-only — can't send messages or interact
- ⚠️ File format is internal and could change

**Effort:** Low for read-only observation, but limited utility.

### Approach 5: Process Inspection (lsof/proc) ⭐⭐

**How:** Use `/proc/{pid}/` to discover CLI sessions and their state.

**Evidence:**
- `/proc/{pid}/cmdline` reveals CLI flags (`--resume`, session IDs)
- `/proc/{pid}/fd` shows file descriptors (PTY connections)
- Lock files in `~/.copilot/session-state/{id}/inuse.{PID}.lock` link PIDs to sessions

**What you get:**
- ✅ Discover which sessions are actively running
- ✅ Map PIDs to session IDs
- ⚠️ Can't read session content or interact
- ⚠️ Platform-specific (Linux /proc)

**Effort:** Low for discovery, but needs to be combined with another approach for actual value.

### Approach 6: VS Code Extension IPC ⭐

**How:** Tap into the VS Code Copilot extension's communication.

**Evidence:**
- `GitHub.copilot-chat@0.39.2` extension is installed
- Extension uses `--node-ipc` for language server communication
- TypeScript server has `@vscode/copilot-typescript-server-plugin`
- Extension's copilot CLI is at `/home/node/.vscode-server/data/User/globalStorage/github.copilot-chat/copilotCli/`

**What you get:**
- ⚠️ VS Code extension's IPC is internal and undocumented
- ⚠️ Extension manages its own Copilot connection separately from CLI
- ⚠️ No public API for external processes

**Effort:** Very high, extremely fragile, not recommended.

---

## 5. Recommended Next Steps

### Phase 1: External Session Discovery (Immediate — Low Effort)

Our daemon already calls `listSessions()` every 30 seconds. The returned list already includes sessions from the terminal CLI. We just need to:

1. **Classify sessions** as "daemon-managed" (in `activeSessions` map) vs "external" (in `listSessions()` but not tracked)
2. **Expose external sessions in HQ** with metadata (summary, cwd, modifiedTime, isRemote)
3. **Allow resuming external sessions** from HQ — `resumeSession()` already works cross-client

This gives users visibility into their terminal CLI sessions from the HQ dashboard.

### Phase 2: Read-Only Event Tailing (Short-Term — Low-Medium Effort)

For sessions we detect as external but don't want to fully resume:

1. **Tail `events.jsonl`** using `fs.watch()` + readline for real-time updates
2. **Parse events** into the same `SessionEvent` format HQ already handles
3. **Forward to HQ** as `copilot-session-event` messages
4. **Add `inuse.*.lock`** file checking to determine if session is actively running

This gives live observation of terminal CLI sessions without interfering.

### Phase 3: Shared CLI Server (Medium-Term — Medium Effort)

For full bidirectional integration:

1. **Start a shared CLI server** in TCP mode via the SDK (`useStdio: false, port: 0`)
2. **Have our daemon connect** via `cliUrl: "localhost:{port}"`
3. **Persist the port** to a well-known file (e.g., `~/.copilot/launchpad-server.json`)
4. **Investigate** whether the interactive `copilot` TUI can be pointed at an external server (may require upstream feature request)

### Decision Point for Arjen

The question is: **what level of integration do you want?**

| Level | What You See | What You Can Do | Effort |
|-------|-------------|-----------------|--------|
| **Discovery** | Session list with metadata | Resume and continue from HQ | 1-2 days |
| **Observation** | Live event stream | Watch conversations in real-time | 3-5 days |
| **Full Integration** | Everything | Create, observe, interact, share sessions | 1-2 weeks |

**My recommendation:** Start with Discovery (Phase 1). It's nearly free — the infrastructure exists. Then evaluate whether Observation (Phase 2) is needed based on user feedback.

---

## Appendix: Key File References

| File | Purpose |
|------|---------|
| `node_modules/@github/copilot-sdk/dist/client.d.ts` | SDK client types — `listSessions`, `resumeSession`, `cliUrl` |
| `node_modules/@github/copilot-sdk/dist/client.js` | SDK client implementation — connection modes, spawn logic |
| `node_modules/@github/copilot-sdk/dist/types.d.ts` | `CopilotClientOptions`, `SessionMetadata`, `SessionListFilter` |
| `src/daemon/copilot/manager.ts` | Our daemon's `CopilotManager` — session lifecycle |
| `~/.copilot/session-state/` | Shared session storage (254 sessions on disk) |
| `~/.copilot/session-store.db` | Shared SQLite session index |
| `~/.copilot/config.json` | Global Copilot CLI config (auth, preferences) |
