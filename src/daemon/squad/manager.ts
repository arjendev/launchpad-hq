/**
 * SquadSessionManager — manages squad-sdk coordinated sessions.
 *
 * Integrates @bradygaster/squad-sdk's SquadCoordinator with the daemon's
 * HQ relay system.  Each squad session is a coordinated multi-agent workflow
 * that routes messages, fans out to agents, and emits structured events.
 */
import { randomUUID } from 'node:crypto';
import type {
  DaemonToHqMessage,
  HqToDaemonMessage,
} from '../../shared/protocol.js';
import { logSdk, logOutgoing } from '../logger.js';
import { bridgeEventBus } from './adapter.js';

// ---------------------------------------------------------------------------
// Dynamic imports — graceful degradation when squad-sdk is absent
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SquadCoordinatorClass: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RuntimeEventBusClass: any = null;

try {
  const sdk = await import('@bradygaster/squad-sdk');
  RuntimeEventBusClass = sdk.RuntimeEventBus;
} catch {
  // squad-sdk main barrel not available
}

try {
  const coordModule = await import('@bradygaster/squad-sdk/coordinator');
  SquadCoordinatorClass = coordModule.SquadCoordinator;
} catch {
  // coordinator subpath not available
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendToHq = (msg: DaemonToHqMessage) => void;

interface SquadSession {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coordinator: any; // SquadCoordinator instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventBus: any; // RuntimeEventBus instance
  unsubscribe: () => void; // EventBus bridge teardown
  startedAt: number;
  updatedAt: number;
  status: 'idle' | 'active' | 'error' | 'ended';
  summary: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
}

export interface SquadSessionManagerOptions {
  /** Callback to relay messages to HQ */
  sendToHq: SendToHq;
  /** Project identifier */
  projectId?: string;
  /**
   * Override coordinator factory for testing.
   * When provided, bypasses the real SquadCoordinator import.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coordinatorFactory?: (options: any) => any;
  /**
   * Override EventBus factory for testing.
   * When provided, bypasses the real RuntimeEventBus import.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventBusFactory?: () => any;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class SquadSessionManager {
  private sessions = new Map<string, SquadSession>();
  private sendToHq: SendToHq;
  private projectId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private coordinatorFactory: ((options: any) => any) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private eventBusFactory: (() => any) | null;
  private available: boolean;

  constructor(options: SquadSessionManagerOptions) {
    this.sendToHq = (msg: DaemonToHqMessage) => {
      logOutgoing(msg.type, 'payload' in msg ? (msg as any).payload : msg);
      options.sendToHq(msg);
    };
    this.projectId = options.projectId ?? 'unknown';

    // Use injected factories (tests) or real SDK classes
    this.coordinatorFactory =
      options.coordinatorFactory ??
      (SquadCoordinatorClass
        ? (opts: any) => new SquadCoordinatorClass(opts)
        : null);

    this.eventBusFactory =
      options.eventBusFactory ??
      (RuntimeEventBusClass ? () => new RuntimeEventBusClass() : null);

    this.available = this.coordinatorFactory !== null;

    if (!this.available) {
      console.warn(
        '⚠ @bradygaster/squad-sdk not available — squad features disabled',
      );
    }
  }

  /** Whether squad-sdk is installed and the coordinator is available */
  isAvailable(): boolean {
    return this.available;
  }

  /** Create a new squad-coordinated session */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createSession(requestId: string, config?: any): Promise<string | null> {
    if (!this.available || !this.coordinatorFactory) {
      logSdk('Squad-sdk not available, cannot create session');
      return null;
    }

    const sessionId = randomUUID();

    try {
      const eventBus = this.eventBusFactory ? this.eventBusFactory() : null;

      const coordinatorOptions: Record<string, unknown> = {
        config: config ?? {},
      };
      if (eventBus) {
        coordinatorOptions.eventBus = eventBus;
      }

      const coordinator = this.coordinatorFactory(coordinatorOptions);

      // Bridge EventBus events → HQ messages
      const unsubscribe = eventBus
        ? bridgeEventBus(eventBus, this.sendToHq, this.projectId, sessionId)
        : () => {};

      const session: SquadSession = {
        id: sessionId,
        coordinator,
        eventBus,
        unsubscribe,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        status: 'idle',
        summary: 'Squad coordinated session',
        config,
      };

      this.sessions.set(sessionId, session);

      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          sessionType: 'squad-sdk',
          event: {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            parentId: null,
            type: 'session.start',
            data: { requestId, sessionId, sessionType: 'squad-sdk' },
          } as any,
        },
      });

      logSdk(`Created squad session: ${sessionId}`);
      return sessionId;
    } catch (err) {
      logSdk(
        `Failed to create squad session: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Send a user message to a squad session's coordinator */
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logSdk(`Squad session ${sessionId} not found`);
      return;
    }

    session.status = 'active';
    session.updatedAt = Date.now();

    try {
      const context = {
        sessionId,
        config: session.config ?? {},
        eventBus: session.eventBus ?? undefined,
      };

      const result = await session.coordinator.handleMessage(message, context);
      logSdk(
        `Squad coordinator result: strategy=${result.strategy}, duration=${result.durationMs}ms`,
      );

      const content = this.extractResultContent(result);
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          sessionType: 'squad-sdk',
          event: {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            parentId: null,
            type: 'assistant.message',
            data: {
              content,
              strategy: result.strategy,
              durationMs: result.durationMs,
            },
          } as any,
        },
      });

      session.status = 'idle';
      session.updatedAt = Date.now();
    } catch (err) {
      session.status = 'error';
      session.updatedAt = Date.now();

      const message =
        err instanceof Error ? err.message : String(err);
      logSdk(`Squad session error: ${message}`);

      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          sessionType: 'squad-sdk',
          event: {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            parentId: null,
            type: 'session.error',
            data: { error: message },
          } as any,
        },
      });
    }
  }

  /** Extract readable content from a CoordinatorResult */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractResultContent(result: any): string {
    if (result.directResponse) {
      return (
        result.directResponse.response ??
        result.directResponse.content ??
        JSON.stringify(result.directResponse)
      );
    }
    if (Array.isArray(result.spawnResults) && result.spawnResults.length > 0) {
      return result.spawnResults
        .map(
          (r: any) =>
            `[${r.agentName ?? 'agent'}]: ${r.status === 'success' ? 'completed' : r.error ?? 'failed'}`,
        )
        .join('\n\n');
    }
    return `Coordinator completed with strategy: ${result.strategy}`;
  }

  /** Terminate a squad session and notify HQ */
  endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.unsubscribe();
    session.status = 'ended';

    this.sendToHq({
      type: 'copilot-session-event',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId,
        sessionType: 'squad-sdk',
        event: {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          parentId: null,
          type: 'session.shutdown',
          data: { sessionId },
        } as any,
      },
    });

    this.sessions.delete(sessionId);
    return true;
  }

  /** List all active squad sessions */
  listSessions(): Array<{
    sessionId: string;
    sessionType: 'squad-sdk';
    status: string;
    summary: string;
    startedAt: number;
    updatedAt: number;
  }> {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.id,
      sessionType: 'squad-sdk' as const,
      status: s.status,
      summary: s.summary,
      startedAt: s.startedAt,
      updatedAt: s.updatedAt,
    }));
  }

  /** Handle an incoming HQ → Daemon message. Returns true if handled. */
  async handleMessage(msg: HqToDaemonMessage): Promise<boolean> {
    switch (msg.type) {
      case 'copilot-create-session': {
        if (msg.payload.sessionType !== 'squad-sdk') return false;
        const sessionId = await this.createSession(
          msg.payload.requestId,
          msg.payload.config,
        );
        return sessionId !== null;
      }
      case 'copilot-send-prompt': {
        if (!this.sessions.has(msg.payload.sessionId)) return false;
        await this.sendMessage(msg.payload.sessionId, msg.payload.prompt);
        return true;
      }
      case 'copilot-delete-session': {
        if (!this.sessions.has(msg.payload.sessionId)) return false;
        this.endSession(msg.payload.sessionId);
        return true;
      }
      case 'copilot-disconnect-session': {
        if (!this.sessions.has(msg.payload.sessionId)) return false;
        this.endSession(msg.payload.sessionId);
        return true;
      }
      default:
        return false;
    }
  }

  /** Check whether a session belongs to this manager */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Shut down all sessions and release resources */
  async stop(): Promise<void> {
    for (const [id] of this.sessions) {
      this.endSession(id);
    }
    this.sessions.clear();
  }
}
