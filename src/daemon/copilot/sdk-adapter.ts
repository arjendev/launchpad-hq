/**
 * Real Copilot SDK adapter.
 *
 * Maps @github/copilot-sdk to our CopilotAdapter interface.
 * If the package is not installed, `isSdkAvailable()` returns false
 * so the manager can fall back to the mock adapter.
 */

import type {
  CopilotSdkSessionInfo,
  CopilotSessionEvent,
  CopilotSdkState,
  CopilotAdapter,
  CopilotSession,
  SessionConfig,
} from './adapter.js';

// ---------------------------------------------------------------------------
// SDK import (may fail if package is not installed)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SdkClientClass: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkApproveAll: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkDefineTool: any = null;
let sdkAvailable = false;

try {
  const sdk = await import('@github/copilot-sdk');
  SdkClientClass = sdk.CopilotClient;
  sdkApproveAll = sdk.approveAll;
  sdkDefineTool = sdk.defineTool;
  sdkAvailable = true;
} catch {
  sdkAvailable = false;
}

// ---------------------------------------------------------------------------
// Public SDK availability check + re-exports
// ---------------------------------------------------------------------------

/** Returns true when @github/copilot-sdk was successfully imported. */
export function isSdkAvailable(): boolean {
  return sdkAvailable;
}

/** Re-export the SDK's `defineTool` (or null when unavailable). */
export function getSdkDefineTool(): typeof sdkDefineTool {
  return sdkDefineTool;
}

// ---------------------------------------------------------------------------
// Event type mapping — SDK uses underscores, our protocol uses dots/camelCase
// ---------------------------------------------------------------------------

const SDK_TO_PROTOCOL_EVENT: Record<string, string> = {
  'assistant.message_delta': 'assistant.message.delta',
  'assistant.streaming_delta': 'assistant.message.delta',
  'assistant.reasoning_delta': 'assistant.reasoning.delta',
  'tool.execution_start': 'tool.executionStart',
  'tool.execution_complete': 'tool.executionComplete',
};

/** Map an SDK event to our CopilotSessionEvent format. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSdkEvent(raw: any): CopilotSessionEvent {
  const mappedType = SDK_TO_PROTOCOL_EVENT[raw.type] ?? raw.type;
  return {
    type: mappedType as CopilotSessionEvent['type'],
    data: raw.data ?? {},
    timestamp: raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertSdk(): void {
  if (!sdkAvailable) {
    throw new Error(
      '@github/copilot-sdk is not installed. ' +
        'Install it via `npm i @github/copilot-sdk` or use LAUNCHPAD_COPILOT_MOCK=true.',
    );
  }
}

// ---------------------------------------------------------------------------
// SDK Session wrapper
// ---------------------------------------------------------------------------

class SdkCopilotSession implements CopilotSession {
  readonly sessionId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private inner: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(inner: any) {
    this.inner = inner;
    this.sessionId = inner.sessionId;
  }

  async send(options: {
    prompt: string;
    attachments?: Array<{ type: string; path: string }>;
  }): Promise<string> {
    const response = await this.inner.sendAndWait(
      { prompt: options.prompt, attachments: options.attachments },
      300_000, // 5 min timeout for long-running agent work
    );
    return response?.data?.content ?? '';
  }

  on(handler: (event: CopilotSessionEvent) => void): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.inner.on((raw: any) => {
      handler(mapSdkEvent(raw));
    });
  }

  async abort(): Promise<void> {
    await this.inner.abort();
  }

  async getMessages(): Promise<CopilotSessionEvent[]> {
    const events = await this.inner.getMessages();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return events.map((e: any) => mapSdkEvent(e));
  }

  async destroy(): Promise<void> {
    await this.inner.disconnect();
  }
}

// ---------------------------------------------------------------------------
// SDK Adapter
// ---------------------------------------------------------------------------

export interface SdkCopilotAdapterOptions {
  cwd?: string;
}

export class SdkCopilotAdapter implements CopilotAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private _state: CopilotSdkState = 'disconnected';
  private stateHandlers: Array<(state: CopilotSdkState) => void> = [];
  private cwd: string;

  constructor(options?: SdkCopilotAdapterOptions) {
    this.cwd = options?.cwd ?? process.cwd();
  }

  get state(): CopilotSdkState {
    if (this.client) {
      return this.client.getState() as CopilotSdkState;
    }
    return this._state;
  }

  async start(): Promise<void> {
    assertSdk();
    this.setState('connecting');

    try {
      this.client = new SdkClientClass({
        cwd: this.cwd,
        autoRestart: true,
        autoStart: false,
        logLevel: 'warning',
      });

      await this.client.start();
      this.setState('connected');
    } catch (err) {
      this.setState('error');
      throw new Error(
        `Failed to start Copilot SDK: ${err instanceof Error ? err.message : String(err)}. ` +
          'Ensure the GitHub Copilot CLI is installed and in PATH.',
      );
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      try {
        await this.client.stop();
      } catch {
        await this.client.forceStop().catch(() => {});
      }
      this.client = null;
    }
    this.setState('disconnected');
  }

  async listSessions(): Promise<CopilotSdkSessionInfo[]> {
    assertSdk();
    if (!this.client) return [];

    const sessions = await this.client.listSessions();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return sessions.map((s: any) => ({
      sessionId: s.sessionId,
      cwd: s.context?.cwd,
      gitRoot: s.context?.gitRoot,
      repository: s.context?.repository,
      branch: s.context?.branch,
      summary: s.summary,
    }));
  }

  async getLastSessionId(): Promise<string | null> {
    assertSdk();
    if (!this.client) return null;
    const id = await this.client.getLastSessionId();
    return id ?? null;
  }

  async createSession(config: SessionConfig): Promise<CopilotSession> {
    assertSdk();
    if (!this.client) {
      throw new Error('SDK client not started — call start() first');
    }

    const sdkConfig = this.toSdkSessionConfig(config);
    const inner = await this.client.createSession(sdkConfig);
    return new SdkCopilotSession(inner);
  }

  async resumeSession(
    sessionId: string,
    config?: Partial<SessionConfig>,
  ): Promise<CopilotSession> {
    assertSdk();
    if (!this.client) {
      throw new Error('SDK client not started — call start() first');
    }

    const sdkConfig = this.toSdkSessionConfig(config ?? {});
    const inner = await this.client.resumeSession(sessionId, sdkConfig);
    return new SdkCopilotSession(inner);
  }

  onStateChange(handler: (state: CopilotSdkState) => void): () => void {
    this.stateHandlers.push(handler);
    return () => {
      this.stateHandlers = this.stateHandlers.filter((h) => h !== handler);
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toSdkSessionConfig(config: Partial<SessionConfig>): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkTools: any[] = (config.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      handler: t.handler,
    }));

    return {
      ...(config.model && { model: config.model }),
      ...(config.systemMessage && { systemMessage: config.systemMessage }),
      ...(config.streaming !== undefined && { streaming: config.streaming }),
      tools: sdkTools,
      onPermissionRequest: sdkApproveAll,
    };
  }

  private setState(next: CopilotSdkState): void {
    this._state = next;
    for (const handler of this.stateHandlers) {
      handler(next);
    }
  }
}
