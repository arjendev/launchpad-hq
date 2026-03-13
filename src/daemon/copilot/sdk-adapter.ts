/**
 * Real Copilot SDK adapter stub.
 *
 * Maps @github/copilot-sdk (technical preview) to our CopilotAdapter
 * interface.  If the package is not installed the adapter throws
 * descriptive errors so consumers can fall back to the mock.
 *
 * Wiring plan (when the SDK becomes available):
 *
 *   SDK class          →  Our interface
 *   ──────────────────────────────────────
 *   CopilotClient      →  CopilotAdapter
 *   client.connect()   →  adapter.start()
 *   client.disconnect() → adapter.stop()
 *   client.sessions()  →  adapter.listSessions()
 *   client.createSession() → adapter.createSession()
 *   session.send()     →  CopilotSession.send()
 *   session.on('event') → CopilotSession.on()
 *   session.abort()    →  CopilotSession.abort()
 *   session.destroy()  →  CopilotSession.destroy()
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

let sdkAvailable = false;

try {
  // Dynamic import so the module can still load when the SDK is absent.
  // When @github/copilot-sdk is published, uncomment the real import:
  //
  //   const sdk = await import('@github/copilot-sdk');
  //   CopilotClient = sdk.CopilotClient;
  //   sdkAvailable = true;
  //
  sdkAvailable = false;
} catch {
  sdkAvailable = false;
}

// ---------------------------------------------------------------------------
// Public SDK availability check
// ---------------------------------------------------------------------------

/** Returns true when @github/copilot-sdk was successfully imported. */
export function isSdkAvailable(): boolean {
  return sdkAvailable;
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

/**
 * Once the SDK ships, this class wraps a real SDK session:
 *
 * ```ts
 * class SdkCopilotSession implements CopilotSession {
 *   constructor(private inner: sdk.Session) {}
 *
 *   async send(opts) {
 *     return this.inner.send(opts.prompt, { attachments: opts.attachments });
 *   }
 *
 *   on(handler) {
 *     const mapped = (raw: sdk.Event) => handler({
 *       type: raw.type as CopilotSessionEvent['type'],
 *       data: raw.data ?? {},
 *       timestamp: raw.timestamp ?? Date.now(),
 *     });
 *     this.inner.on('event', mapped);
 *     return () => this.inner.off('event', mapped);
 *   }
 *
 *   abort()    { return this.inner.abort(); }
 *   destroy()  { return this.inner.destroy(); }
 *   getMessages() { return this.inner.getMessages(); }
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// SDK Adapter
// ---------------------------------------------------------------------------

export class SdkCopilotAdapter implements CopilotAdapter {
  private _state: CopilotSdkState = 'disconnected';
  private stateHandlers: Array<(state: CopilotSdkState) => void> = [];

  get state(): CopilotSdkState {
    return this._state;
  }

  async start(): Promise<void> {
    assertSdk();
    // Would call: this.client = new CopilotClient(); await this.client.connect();
    this.setState('connecting');
    this.setState('connected');
  }

  async stop(): Promise<void> {
    assertSdk();
    // Would call: await this.client.disconnect();
    this.setState('disconnected');
  }

  async listSessions(): Promise<CopilotSdkSessionInfo[]> {
    assertSdk();
    // Would call: const sessions = await this.client.sessions();
    // return sessions.map(s => ({ sessionId: s.id, cwd: s.cwd, ... }));
    return [];
  }

  async getLastSessionId(): Promise<string | null> {
    assertSdk();
    return null;
  }

  async createSession(_config: SessionConfig): Promise<CopilotSession> {
    assertSdk();
    // Would call: const session = await this.client.createSession(config);
    // return new SdkCopilotSession(session);
    throw new Error('SDK not available — createSession stub');
  }

  async resumeSession(
    _sessionId: string,
    _config?: Partial<SessionConfig>,
  ): Promise<CopilotSession> {
    assertSdk();
    throw new Error('SDK not available — resumeSession stub');
  }

  onStateChange(handler: (state: CopilotSdkState) => void): () => void {
    this.stateHandlers.push(handler);
    return () => {
      this.stateHandlers = this.stateHandlers.filter((h) => h !== handler);
    };
  }

  private setState(next: CopilotSdkState): void {
    this._state = next;
    for (const handler of this.stateHandlers) {
      handler(next);
    }
  }
}
