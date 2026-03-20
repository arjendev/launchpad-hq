# @github/copilot-sdk Deep Research Spike Report

## 1. MCP SERVER CONFIGURATION

### SessionConfig MCP Support
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 509-603)

```typescript
export interface SessionConfig {
  // ... other fields ...
  
  /**
   * MCP server configurations for the session.
   * Keys are server names, values are server configurations.
   */
  mcpServers?: Record<string, MCPServerConfig>;
  
  // ... rest of fields ...
}
```

### MCP Server Type Definitions
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 398-445)

#### MCPServerConfigBase Interface
```typescript
interface MCPServerConfigBase {
  /**
   * List of tools to include from this server. [] means none. "*" means all.
   */
  tools: string[];
  
  /**
   * Indicates "remote" or "local" server type.
   * If not specified, defaults to "local".
   */
  type?: string;
  
  /**
   * Optional timeout in milliseconds for tool calls to this server.
   */
  timeout?: number;
}
```

#### MCPLocalServerConfig Interface
```typescript
export interface MCPLocalServerConfig extends MCPServerConfigBase {
  type?: "local" | "stdio";
  command: string;
  args: string[];
  /**
   * Environment variables to pass to the server.
   */
  env?: Record<string, string>;
  cwd?: string;
}
```

#### MCPRemoteServerConfig Interface
```typescript
export interface MCPRemoteServerConfig extends MCPServerConfigBase {
  type: "http" | "sse";
  /**
   * URL of the remote server.
   */
  url: string;
  /**
   * Optional HTTP headers to include in requests.
   */
  headers?: Record<string, string>;
}
```

#### Union Type
```typescript
export type MCPServerConfig = MCPLocalServerConfig | MCPRemoteServerConfig;
```

### ResumeSessionConfig MCP Support
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 605-614)

```typescript
export type ResumeSessionConfig = Pick<SessionConfig, "clientName" | "model" | 
  "tools" | "systemMessage" | "availableTools" | "excludedTools" | "provider" | 
  "streaming" | "reasoningEffort" | "onPermissionRequest" | "onUserInputRequest" | 
  "hooks" | "workingDirectory" | "configDir" | "mcpServers" | "customAgents" | 
  "skillDirectories" | "disabledSkills" | "infiniteSessions"> & {
  /**
   * When true, skips emitting the session.resume event.
   * Useful for reconnecting to a session without triggering resume-related side effects.
   * @default false
   */
  disableResume?: boolean;
};
```

✅ **YES: `mcpServers` is included in ResumeSessionConfig.** MCP servers can be passed at both session creation and resume.

### CustomAgentConfig MCP Support
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 449-480)

```typescript
export interface CustomAgentConfig {
  /**
   * Unique name of the custom agent.
   */
  name: string;
  
  /**
   * Display name for UI purposes.
   */
  displayName?: string;
  
  /**
   * Description of what the agent does.
   */
  description?: string;
  
  /**
   * List of tool names the agent can use.
   * Use null or undefined for all tools.
   */
  tools?: string[] | null;
  
  /**
   * The prompt content for the agent.
   */
  prompt: string;
  
  /**
   * MCP servers specific to this agent.
   */
  mcpServers?: Record<string, MCPServerConfig>;
  
  /**
   * Whether the agent should be available for model inference.
   * @default true
   */
  infer?: boolean;
}
```

✅ **YES: CustomAgentConfig has `mcpServers` field.** Each custom agent can have its own MCP server configuration.

### MCP Permission Event Types
**File**: `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts` (lines 2107-2250)

```typescript
// Permission Request Event
type PermissionRequestEvent = {
  type: "permission.requested";
  data: {
    /**
     * Unique identifier for this permission request; used to respond via 
     * session.respondToPermission()
     */
    requestId: string;
    
    /**
     * Details of the permission being requested
     */
    permissionRequest: {
      kind: "mcp";
      /**
       * Tool call ID that triggered this permission request
       */
      toolCallId?: string;
      /**
       * Name of the MCP server providing the tool
       */
      serverName: string;
      /**
       * Internal name of the MCP tool
       */
      toolName: string;
      /**
       * Human-readable title of the MCP tool
       */
      toolTitle: string;
      /**
       * Arguments to pass to the MCP tool
       */
      args?: {
        [k: string]: unknown;
      };
      /**
       * Whether this MCP tool is read-only (no side effects)
       */
      readOnly: boolean;
    };
  };
} | { /* other permission kinds: shell, write, read, url, custom-tool */ };

// Permission Completed Event
type PermissionCompletedEvent = {
  type: "permission.completed";
  data: {
    /**
     * Request ID of the resolved permission request
     */
    requestId: string;
    /**
     * The result of the permission request
     */
    permissionResult: {
      outcome: "allowed" | "denied";
      // ... additional fields
    };
  };
};
```

---

## 2. TOOL REGISTRATION

### defineTool() API Signature
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 137-142)

```typescript
export declare function defineTool<T = unknown>(
  name: string, 
  config: {
    description?: string;
    parameters?: ZodSchema<T> | Record<string, unknown>;
    handler: ToolHandler<T>;
    overridesBuiltInTool?: boolean;
  }
): Tool<T>;
```

### Tool Interface
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 121-132)

```typescript
export interface Tool<TArgs = unknown> {
  name: string;
  description?: string;
  parameters?: ZodSchema<TArgs> | Record<string, unknown>;
  handler: ToolHandler<TArgs>;
  /**
   * When true, explicitly indicates this tool is intended to override a built-in tool
   * of the same name. If not set and the name clashes with a built-in tool, the runtime
   * will return an error.
   */
  overridesBuiltInTool?: boolean;
}
```

### Tool Handler Type
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 100-106)

```typescript
export interface ToolInvocation {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
}

export type ToolHandler<TArgs = unknown> = (
  args: TArgs, 
  invocation: ToolInvocation
) => Promise<unknown> | unknown;
```

### Tool Registration Flow

**At Session Creation Time:**
```typescript
// From SessionConfig (line 538)
tools?: Tool<any>[];
```

✅ **Tools must be provided at session creation via `SessionConfig.tools[]`**

**At Session Resume Time:**
```typescript
// ResumeSessionConfig includes "tools" in Pick<SessionConfig, ...>
// From manager.ts line 607
tools?: Tool<any>[];
```

✅ **Tools CAN be provided when resuming a session** (part of ResumeSessionConfig)

**Can Tools Be Added to Running Session?**
- **File**: `node_modules/@github/copilot-sdk/dist/session.d.ts` (lines 182-190)

```typescript
/**
 * Registers custom tool handlers for this session.
 *
 * Tools allow the assistant to execute custom functions. When the assistant
 * invokes a tool, the corresponding handler is called with the tool arguments.
 *
 * @param tools - An array of tool definitions with their handlers, or undefined to clear all tools
 * @internal This method is typically called internally when creating a session with tools.
 */
registerTools(tools?: Tool[]): void;
```

❌ **NO DIRECT PUBLIC API** - `registerTools()` is marked `@internal` — not intended for external use. Tools are designed to be specified at creation/resume time only, not dynamically during execution.

### Tool Namespacing
- **File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (line 122)

```typescript
name: string;  // Tool name only — no namespace prefix
```

❌ **NO NAMESPACING** - Tool names are flat strings. No built-in namespacing (e.g., "mcp:server/tool" syntax). Namespacing must be managed by the caller if needed.

### Tool Invocation Details
**File**: `generated/session-events.d.ts` (lines 1482-1486)

```typescript
data: {
  // ...
  mcpServerName?: string;      // If tool came from MCP server
  // ...
  mcpToolName?: string;        // Internal name of MCP tool
  // ...
}
```

---

## 3. CUSTOM INSTRUCTIONS / SYSTEM PROMPTS

### SystemMessageConfig Interface
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 154-179)

```typescript
/**
 * Append mode: Use CLI foundation with optional appended content (default).
 */
export interface SystemMessageAppendConfig {
  mode?: "append";
  /**
   * Additional instructions appended after SDK-managed sections.
   */
  content?: string;
}

/**
 * Replace mode: Use caller-provided system message entirely.
 * Removes all SDK guardrails including security restrictions.
 */
export interface SystemMessageReplaceConfig {
  mode: "replace";
  /**
   * Complete system message content.
   * Replaces the entire SDK-managed system message.
   */
  content: string;
}

/**
 * System message configuration for session creation.
 * - Append mode (default): SDK foundation + optional custom content
 * - Replace mode: Full control, caller provides entire system message
 */
export type SystemMessageConfig = SystemMessageAppendConfig | SystemMessageReplaceConfig;
```

### SessionConfig System Message Field
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 540-543)

```typescript
/**
 * System message configuration
 * Controls how the system prompt is constructed
 */
systemMessage?: SystemMessageConfig;
```

✅ **SessionConfig supports custom system messages** with two modes:
1. **append** (default) — Add custom instructions on top of SDK defaults
2. **replace** — Full control, replace entire system message

### ResumeSessionConfig System Message
**Included** in the `Pick<SessionConfig>` — systemMessage can be changed when resuming.

### Skill Directories and Instructions
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 591-596)

```typescript
/**
 * Directories to load skills from.
 */
skillDirectories?: string[];

/**
 * List of skill names to disable.
 */
disabledSkills?: string[];
```

ℹ️ **Skills** are a separate concept from MCP servers. Skills are loaded from directories (e.g., `copilot-instructions.md` files). The SDK supports specifying skill directories at session creation/resume time.

### Daemon Implementation
**File**: `src/daemon/copilot/system-message.ts` (lines 8-21)

```typescript
export function buildSystemMessage(
  projectId: string,
  projectName?: string,
): { mode: 'append'; content: string } {
  return {
    mode: 'append',
    content: `You are working on the project "${projectName || projectId}" managed by launchpad-hq.
You have access to these additional tools for communicating with the human operator:
- report_progress: Report your current task status and progress summary
- request_human_review: Request human attention when you need a decision or review
- report_blocker: Signal that you are blocked and cannot proceed
Use these tools proactively to keep the operator informed of your progress.`,
  };
}
```

---

## 4. SESSION CREATION FLOW

### CopilotClient.createSession() Signature
**File**: `node_modules/@github/copilot-sdk/dist/client.d.ts` (lines 125-153)

```typescript
/**
 * Creates a new conversation session with the Copilot CLI.
 *
 * Sessions maintain conversation state, handle events, and manage tool execution.
 * If the client is not connected and `autoStart` is enabled, this will automatically
 * start the connection.
 *
 * @param config - Optional configuration for the session
 * @returns A promise that resolves with the created session
 * @throws Error if the client is not connected and autoStart is disabled
 *
 * @example
 * ```typescript
 * // Basic session
 * const session = await client.createSession({ onPermissionRequest: approveAll });
 *
 * // Session with model and tools
 * const session = await client.createSession({
 *   onPermissionRequest: approveAll,
 *   model: "gpt-4",
 *   tools: [{
 *     name: "get_weather",
 *     description: "Get weather for a location",
 *     parameters: { type: "object", properties: { location: { type: "string" } } },
 *     handler: async (args) => ({ temperature: 72 })
 *   }]
 * });
 * ```
 */
createSession(config: SessionConfig): Promise<CopilotSession>;
```

### CopilotClient.resumeSession() Signature
**File**: `node_modules/@github/copilot-sdk/dist/client.d.ts` (lines 154-178)

```typescript
/**
 * Resumes an existing conversation session by its ID.
 *
 * This allows you to continue a previous conversation, maintaining all
 * conversation history. The session must have been previously created
 * and not deleted.
 *
 * @param sessionId - The ID of the session to resume
 * @param config - Optional configuration for the resumed session
 * @returns A promise that resolves with the resumed session
 * @throws Error if the session does not exist or the client is not connected
 *
 * @example
 * ```typescript
 * // Resume a previous session
 * const session = await client.resumeSession("session-123", { onPermissionRequest: approveAll });
 *
 * // Resume with new tools
 * const session = await client.resumeSession("session-123", {
 *   onPermissionRequest: approveAll,
 *   tools: [myNewTool]
 * });
 * ```
 */
resumeSession(sessionId: string, config: ResumeSessionConfig): Promise<CopilotSession>;
```

### Complete SessionConfig Interface
**File**: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 509-603)

```typescript
export interface SessionConfig {
  /**
   * Optional custom session ID
   * If not provided, server will generate one
   */
  sessionId?: string;

  /**
   * Client name to identify the application using the SDK.
   * Included in the User-Agent header for API requests.
   */
  clientName?: string;

  /**
   * Model to use for this session
   */
  model?: string;

  /**
   * Reasoning effort level for models that support it.
   * Only valid for models where capabilities.supports.reasoningEffort is true.
   * Use client.listModels() to check supported values for each model.
   */
  reasoningEffort?: ReasoningEffort;

  /**
   * Override the default configuration directory location.
   * When specified, the session will use this directory for storing config and state.
   */
  configDir?: string;

  /**
   * Tools exposed to the CLI server
   */
  tools?: Tool<any>[];

  /**
   * System message configuration
   * Controls how the system prompt is constructed
   */
  systemMessage?: SystemMessageConfig;

  /**
   * List of tool names to allow. When specified, only these tools will be available.
   * Takes precedence over excludedTools.
   */
  availableTools?: string[];

  /**
   * List of tool names to disable. All other tools remain available.
   * Ignored if availableTools is specified.
   */
  excludedTools?: string[];

  /**
   * Custom provider configuration (BYOK - Bring Your Own Key).
   * When specified, uses the provided API endpoint instead of the Copilot API.
   */
  provider?: ProviderConfig;

  /**
   * Handler for permission requests from the server.
   * When provided, the server will call this handler to request permission for operations.
   */
  onPermissionRequest: PermissionHandler;

  /**
   * Handler for user input requests from the agent.
   * When provided, enables the ask_user tool allowing the agent to ask questions.
   */
  onUserInputRequest?: UserInputHandler;

  /**
   * Hook handlers for intercepting session lifecycle events.
   * When provided, enables hooks callback allowing custom logic at various points.
   */
  hooks?: SessionHooks;

  /**
   * Working directory for the session.
   * Tool operations will be relative to this directory.
   */
  workingDirectory?: string;

  streaming?: boolean;

  /**
   * MCP server configurations for the session.
   * Keys are server names, values are server configurations.
   */
  mcpServers?: Record<string, MCPServerConfig>;

  /**
   * Custom agent configurations for the session.
   */
  customAgents?: CustomAgentConfig[];

  /**
   * Directories to load skills from.
   */
  skillDirectories?: string[];

  /**
   * List of skill names to disable.
   */
  disabledSkills?: string[];

  /**
   * Infinite session configuration for persistent workspaces and automatic compaction.
   * When enabled (default), sessions automatically manage context limits and persist state.
   * Set to `{ enabled: false }` to disable.
   */
  infiniteSessions?: InfiniteSessionConfig;
}
```

### Daemon Implementation: buildSharedSdkConfig()
**File**: `src/daemon/copilot/manager.ts` (lines 1045-1055)

```typescript
/** Build a typed SDK config from a wire config + HQ injections */
private buildSharedSdkConfig(wire?: Partial<SessionConfigWire>): SharedSdkConfig {
  const config = wire ?? {};
  return {
    ...(config.model && { model: config.model }),
    ...(config.streaming !== undefined && { streaming: config.streaming }),
    systemMessage: config.systemMessage ?? buildSystemMessage(this.projectId, this.projectName),
    tools: [...this.hqTools],
    ...(this.customAgents.length > 0 ? { customAgents: this.customAgents } : {}),
    onPermissionRequest: approveAll,
  };
}
```

The daemon:
1. Merges wire config with defaults
2. **Always injects HQ communication tools** (`report_progress`, `request_human_review`, `report_blocker`)
3. **Always injects system message** with HQ context (or uses provided systemMessage)
4. **Injects customAgents** if configured
5. **Uses approveAll** permission handler (no permission prompts to user)

### SharedSdkConfig Type
**File**: `src/daemon/copilot/manager.ts` (lines 52-55)

```typescript
type SharedSdkConfig = Pick<
  SessionConfig,
  'model' | 'streaming' | 'systemMessage' | 'tools' | 'onPermissionRequest' | 'customAgents'
>;
```

---

## 5. SESSION EVENTS (MCP-Related)

### MCP Permission Request Event
**Type**: `permission.requested`
**File**: `generated/session-events.d.ts`

```typescript
{
  type: "permission.requested";
  data: {
    requestId: string;
    permissionRequest: {
      kind: "mcp";
      toolCallId?: string;
      serverName: string;        // MCP server name
      toolName: string;          // Tool internal name
      toolTitle: string;         // Human-readable title
      args?: Record<string, unknown>;
      readOnly: boolean;         // Side effect status
    };
  };
}
```

### MCP Tool Invocation Event
**Type**: `tool.invoked`
**File**: `generated/session-events.d.ts`

```typescript
data: {
  toolName: string;
  toolCallId: string;
  arguments?: unknown;
  mcpServerName?: string;        // Set if tool came from MCP
  mcpToolName?: string;          // Internal tool name if from MCP
  // ... other fields
}
```

### MCP Informational Message Event
**Type**: `message.info`
**File**: `generated/session-events.d.ts`

```typescript
data: {
  category?: string;  // Can be "mcp" for MCP-related info
  message: string;
  // ... other fields
}
```

### MCP Warning Event
**Type**: `message.warning`
**File**: `generated/session-events.d.ts`

```typescript
data: {
  category?: string;  // Can be "mcp" for MCP-related warnings
  message: string;
  // ... other fields
}
```

---

## 6. DAEMON INTEGRATION (buildSharedSdkConfig & SessionConfigWire)

### SessionConfigWire (Wire Protocol)
**File**: `src/shared/protocol.ts` (lines 191-198)

```typescript
/** Session configuration sent over the wire (handler-free subset of SDK SessionConfig) */
export interface SessionConfigWire {
  sessionType?: SessionType;
  model?: string;
  agentId?: string | null;
  systemMessage?: { mode: 'append' | 'replace'; content: string };
  tools?: ToolDefinitionWire[];  // Wire-safe (no handlers)
  streaming?: boolean;
}
```

⚠️ **NOTE**: `SessionConfigWire` does NOT include `mcpServers` or `customAgents`. These are:
- Not exposed over the WebSocket protocol
- Configured **locally in the daemon** at startup
- **NOT user-configurable per session** via HQ commands

### ToolDefinitionWire (Tool Definition Over Wire)
**File**: `src/shared/protocol.ts` (lines 169-173)

```typescript
/** Tool definition (wire-safe — no handler) for session configuration */
export interface ToolDefinitionWire {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  // Note: handler is NOT included in wire format
}
```

### Daemon Session Creation Flow
**File**: `src/daemon/copilot/manager.ts` (lines 349-392)

```typescript
private async handleCreateSession(
  requestId: string,
  config?: SessionConfigWire,
): Promise<void> {
  try {
    const selectedAgent = this.resolveRequestedAgent(config?.agentId);
    const sdkConfig: SessionConfig = this.buildSharedSdkConfig(config);
    const session = await this.client.createSession(sdkConfig);
    logSdk(`Session created: ${session.sessionId}`);
    this.trackSession(session, true);
    await this.applyAgentSelection(session, selectedAgent);
    const currentAgent = await this.getCurrentSessionAgent(session);

    // SDK will emit session.start via the event handler, but we also send
    // a synthetic event so HQ can correlate the requestId
    this.sendToHq({
      type: 'copilot-session-event',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId: session.sessionId,
        event: syntheticEvent('session.start', {
          requestId,
          sessionId: session.sessionId,
          ...this.toAgentEventData(currentAgent),
        }),
      },
    });
  } catch (err) {
    // Error handling...
  }
}
```

---

## 7. DAEMON MCP IMPLEMENTATION STATUS

### Current Daemon MCP Support
**File**: `src/daemon/copilot/manager.ts`

```typescript
private customAgents: CustomAgentConfig[];

constructor(options: CopilotManagerOptions) {
  // ...
  this.customAgents = options.customAgents ?? [];
  // ...
}

// And in buildSharedSdkConfig():
...(this.customAgents.length > 0 ? { customAgents: this.customAgents } : {}),
```

✅ **Daemon supports CustomAgentConfig with MCP servers** — passed at daemon startup
❌ **Daemon does NOT support dynamic MCP server configuration per session** — not part of SessionConfigWire
❌ **HQ cannot add/remove MCP servers at runtime** — would require protocol extension

---

## 8. EXAMPLE: Using defineTool() in Daemon

**File**: `src/daemon/copilot/hq-tools.ts` (lines 1-141)

```typescript
import { defineTool } from '@github/copilot-sdk';
import type { Tool, ToolInvocation } from '@github/copilot-sdk';

type ReportProgressArgs = {
  status: 'working' | 'completed' | 'blocked';
  summary: string;
  details?: string;
};

export function createHqTools(
  sendToHq: (msg: DaemonToHqMessage) => void,
  projectId: string,
): Tool[] {
  return [
    defineTool<ReportProgressArgs>('report_progress', {
      description:
        'Report your current task status and progress summary to the human operator at HQ.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['working', 'completed', 'blocked'],
            description: 'Current work state.',
          },
          summary: {
            type: 'string',
            description: 'Brief summary of current progress.',
          },
          details: {
            type: 'string',
            description: 'Optional detailed information.',
          },
        },
        required: ['status', 'summary'],
      },
      handler: async (args: ReportProgressArgs, invocation: ToolInvocation) => {
        sendToHq({
          type: 'copilot-tool-invocation',
          sessionId: invocation.sessionId,
          projectId,
          tool: 'report_progress',
          args,
          timestamp: Date.now(),
        });
        return { acknowledged: true, message: 'Progress reported to operator.' };
      },
    }),
    // ... more tools
  ] as Tool[];
}
```

---

## KEY FINDINGS SUMMARY

### ✅ SUPPORTED
1. **MCP Servers**: Full support via `SessionConfig.mcpServers` and `CustomAgentConfig.mcpServers`
2. **System Messages**: Append/replace modes via `SystemMessageConfig`
3. **Tool Registration**: At session creation and resume via `SessionConfig.tools[]` and `ResumeSessionConfig.tools[]`
4. **MCP Permissions**: Full event support (permission.requested, permission.completed)
5. **Custom Agents**: Full support with per-agent MCP servers
6. **Skill Directories**: Supported via `SessionConfig.skillDirectories[]`
7. **HQ Tool Communication**: Daemon injects HQ-specific tools at session creation

### ⚠️ LIMITATIONS
1. **Dynamic Tool Addition**: `registerTools()` is @internal — not for external use
2. **Tool Namespacing**: No built-in namespacing — flat tool names only
3. **Per-Session MCP Config**: `SessionConfigWire` does NOT expose `mcpServers` — only configurable at daemon startup
4. **Runtime Tool Updates**: Cannot add/remove tools or MCP servers while session is running

### 🔍 DAEMON-SPECIFIC NOTES
1. **Hardcoded HQ Tools**: Daemon always injects `report_progress`, `request_human_review`, `report_blocker`
2. **System Message Injection**: Daemon always appends HQ context to system message
3. **Custom Agents at Startup**: `CustomAgentConfig[]` passed to CopilotManager constructor, not per-session
4. **Wire Protocol Gap**: `SessionConfigWire` is minimal — no MCP or custom agent fields

