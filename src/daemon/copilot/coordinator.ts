/**
 * CopilotCoordinator — multi-agent coordination using copilot-sdk.
 *
 * Creates an orchestrator session that can spawn sub-agent sessions as tools.
 * Each sub-agent has its own model, tools, system prompt, and context.
 * Sub-agent events are tagged with parentSessionId and forwarded to HQ.
 */

import { randomUUID } from 'node:crypto';
import type { DaemonToHqMessage } from '../../shared/protocol.js';
import { logSdk } from '../logger.js';

export type SendToHq = (msg: DaemonToHqMessage) => void;

/** Definition of a sub-agent that can be spawned by the orchestrator */
export interface SubAgentDefinition {
  /** Unique name for this sub-agent (used as tool name on orchestrator) */
  name: string;
  /** Human-readable description (used as tool description) */
  description: string;
  /** Model to use for this sub-agent's session */
  model?: string;
  /** System message for the sub-agent */
  systemMessage?: string;
  /** Additional tools the sub-agent should have */
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}

/** Configuration for creating a coordinated multi-agent session */
export interface CoordinatorConfig {
  /** Model for the orchestrator session */
  model?: string;
  /** System message for the orchestrator */
  systemMessage?: string;
  /** Sub-agent definitions — each becomes a tool on the orchestrator */
  agents: SubAgentDefinition[];
  /** Whether to use infinite sessions for long-running coordination */
  infiniteSessions?: boolean;
}

/** Tracked sub-agent entry */
interface SubAgentEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  definition: SubAgentDefinition;
  unsub?: () => void;
}

/**
 * Orchestrates multiple copilot-sdk sessions for multi-agent workflows.
 *
 * Usage:
 *   const coordinator = new CopilotCoordinator({ sendToHq, projectId, client });
 *   const sessionId = await coordinator.createCoordinatedSession(requestId, config);
 *   // The orchestrator session is now active with sub-agent tools
 *   // Send prompts to it like a normal session — it will spawn sub-agents as needed
 */
export class CopilotCoordinator {
  private sendToHq: SendToHq;
  private projectId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private orchestratorSessionId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private orchestratorSession: any = null;
  private subAgentSessions = new Map<string, SubAgentEntry>();
  private config: CoordinatorConfig | null = null;

  constructor(options: {
    sendToHq: SendToHq;
    projectId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any; // CopilotClient instance (duck-typed)
  }) {
    this.sendToHq = options.sendToHq;
    this.projectId = options.projectId;
    this.client = options.client;
  }

  /**
   * Create a coordinated session with an orchestrator + sub-agent tools.
   * Returns the orchestrator session ID.
   */
  async createCoordinatedSession(requestId: string, config: CoordinatorConfig): Promise<string> {
    this.config = config;

    // Build sub-agent tools for the orchestrator
    const subAgentTools = config.agents.map((agent) => this.buildSubAgentTool(agent));

    // Create the orchestrator session
    const systemContent = config.systemMessage ?? this.buildOrchestratorSystemMessage(config.agents);

    const sessionConfig: Record<string, unknown> = {
      model: config.model,
      systemMessage: { mode: 'append', content: systemContent },
      tools: subAgentTools,
      streaming: true,
    };

    if (config.infiniteSessions) {
      Object.assign(sessionConfig, {
        infiniteSessions: {
          enabled: true,
          backgroundCompactionThreshold: 0.8,
          bufferExhaustionThreshold: 0.95,
        },
      });
    }

    this.orchestratorSession = await this.client.createSession(sessionConfig);
    const sessionId: string = this.orchestratorSession.sessionId ?? randomUUID();
    this.orchestratorSessionId = sessionId;

    // Wire orchestrator events → HQ
    this.wireSessionEvents(sessionId, this.orchestratorSession);

    // Send synthetic start event
    this.sendToHq({
      type: 'copilot-session-event',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        sessionId,
        sessionType: 'copilot-sdk',
        event: {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          parentId: null,
          type: 'session.start',
          data: {
            requestId,
            sessionId,
            sessionType: 'copilot-sdk',
            isCoordinator: true,
            agents: config.agents.map((a) => a.name),
          },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
    });

    logSdk(
      `Created coordinated session ${sessionId} with ${config.agents.length} sub-agents`,
    );
    return sessionId;
  }

  /** Build a tool definition that spawns a sub-agent session when called */
  private buildSubAgentTool(agent: SubAgentDefinition): Record<string, unknown> {
    return {
      name: agent.name,
      description: agent.description,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: `The task to delegate to the ${agent.name} agent`,
          },
        },
        required: ['prompt'],
      },
      handler: async (args: { prompt: string }) => {
        return this.spawnSubAgent(agent, args.prompt);
      },
    };
  }

  /** Spawn a sub-agent session, send a prompt, wait for result, clean up */
  async spawnSubAgent(agent: SubAgentDefinition, prompt: string): Promise<string> {
    const startTime = Date.now();
    logSdk(`Spawning sub-agent: ${agent.name}`);

    try {
      const sessionConfig: Record<string, unknown> = {
        model: agent.model,
        streaming: true,
      };
      if (agent.systemMessage) {
        Object.assign(sessionConfig, {
          systemMessage: { mode: 'append', content: agent.systemMessage },
        });
      }

      const session = await this.client.createSession(sessionConfig);
      const subSessionId: string = session.sessionId ?? randomUUID();

      // Wire sub-agent events → HQ (tagged with parent)
      const unsub = this.wireSessionEvents(
        subSessionId,
        session,
        this.orchestratorSessionId ?? undefined,
      );

      this.subAgentSessions.set(subSessionId, { session, definition: agent, unsub });

      // Notify HQ about sub-agent spawn
      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId: subSessionId,
          sessionType: 'copilot-sdk',
          event: {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            parentId: null,
            type: 'session.start',
            data: {
              sessionId: subSessionId,
              parentSessionId: this.orchestratorSessionId,
              agentRole: agent.name,
              sessionType: 'copilot-sdk',
            },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        },
      });

      // Send the prompt and wait for result
      const result = await session.sendAndWait({ prompt });
      const content: string = result?.data?.content ?? 'No result from sub-agent';
      const durationMs = Date.now() - startTime;

      logSdk(`Sub-agent ${agent.name} completed in ${durationMs}ms`);

      // Clean up sub-agent session
      try {
        await session.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.subAgentSessions.delete(subSessionId);

      return content;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logSdk(`Sub-agent ${agent.name} failed: ${errorMsg}`);
      return `Error from ${agent.name}: ${errorMsg}`;
    }
  }

  /** Wire session.on() events to HQ relay */
  private wireSessionEvents(
    sessionId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: any,
    parentSessionId?: string,
  ): (() => void) | undefined {
    if (typeof session.on !== 'function') return undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return session.on((event: any) => {
      const eventData = { ...(event.data ?? {}) };
      if (parentSessionId) {
        eventData.parentSessionId = parentSessionId;
      }

      this.sendToHq({
        type: 'copilot-session-event',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          sessionId,
          sessionType: 'copilot-sdk',
          event: {
            ...event,
            data: eventData,
          },
        },
      });
    });
  }

  /** Build a default system message for the orchestrator */
  private buildOrchestratorSystemMessage(agents: SubAgentDefinition[]): string {
    const agentList = agents.map((a) => `- ${a.name}: ${a.description}`).join('\n');
    return [
      'You are an orchestrator agent coordinating a team of specialists.',
      'You can delegate tasks to the following agents:',
      '',
      agentList,
      '',
      'Analyze the user\'s request, break it into subtasks, and delegate to the appropriate agents.',
      'Collect their results and synthesize a final response.',
    ].join('\n');
  }

  /** Send a prompt to the orchestrator session */
  async sendPrompt(prompt: string): Promise<void> {
    if (!this.orchestratorSession) {
      throw new Error('No active coordinated session');
    }
    await this.orchestratorSession.send({ prompt });
  }

  /** Abort the orchestrator session */
  async abort(): Promise<void> {
    if (this.orchestratorSession?.abort) {
      await this.orchestratorSession.abort();
    }
  }

  /** Get the orchestrator session ID */
  getSessionId(): string | null {
    return this.orchestratorSessionId;
  }

  /** Check if a session belongs to this coordinator (orchestrator or sub-agent) */
  hasSession(sessionId: string): boolean {
    return sessionId === this.orchestratorSessionId || this.subAgentSessions.has(sessionId);
  }

  /** Shut down the coordinator and all sessions */
  async stop(): Promise<void> {
    // Disconnect sub-agents first
    for (const [, { session, unsub }] of this.subAgentSessions) {
      try {
        if (unsub) unsub();
        await session.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.subAgentSessions.clear();

    // Disconnect orchestrator
    if (this.orchestratorSession) {
      try {
        await this.orchestratorSession.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.orchestratorSession = null;
    this.orchestratorSessionId = null;
    this.config = null;
  }
}
