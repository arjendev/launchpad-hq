/**
 * AgentResolver — resolves agent catalog entries for session creation.
 *
 * Owns the agent catalog Map and provides lookup methods for agent selection
 * by ID, name, or fuzzy match. Used by CopilotManager for session create/resume
 * and coordinator session setup.
 */

import type { CopilotSession } from '@github/copilot-sdk';
import type { CopilotAgentCatalogEntry } from '../../shared/protocol.js';
import {
  DEFAULT_COPILOT_AGENT_ID,
  createDefaultCopilotAgentCatalogEntry,
} from './agent-catalog.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionRpc = CopilotSession['rpc'];
type CopilotCurrentAgentState = Awaited<ReturnType<SessionRpc['agent']['getCurrent']>>;

type CopilotSessionLike = Pick<
  CopilotSession,
  'sessionId' | 'send' | 'abort' | 'disconnect' | 'setModel' | 'on'
> & {
  rpc: SessionRpc;
};

export interface CurrentSessionAgentSelection {
  agentId: string | null;
  agentName: string | null;
  agentDisplayName: string | null;
}

// ---------------------------------------------------------------------------
// AgentResolver
// ---------------------------------------------------------------------------

export class AgentResolver {
  private agentCatalog = new Map<string, CopilotAgentCatalogEntry>();

  constructor(catalog?: CopilotAgentCatalogEntry[]) {
    for (const agent of catalog ?? []) {
      this.agentCatalog.set(agent.id, agent);
    }
    if (!this.agentCatalog.has(DEFAULT_COPILOT_AGENT_ID)) {
      const defaultAgent = createDefaultCopilotAgentCatalogEntry();
      this.agentCatalog.set(defaultAgent.id, defaultAgent);
    }
  }

  /** Get the catalog Map (read-only access for coordinator logging, etc.) */
  get catalog(): ReadonlyMap<string, CopilotAgentCatalogEntry> {
    return this.agentCatalog;
  }

  /** Resolve the agent entry for a requested agentId. Throws if unknown. */
  resolveRequestedAgent(requestedAgentId?: string | null): CopilotAgentCatalogEntry {
    const selectedAgent =
      this.findAgentEntry(requestedAgentId) ??
      (requestedAgentId === undefined || requestedAgentId === null
        ? this.getDefaultAgentEntry()
        : undefined);

    if (!selectedAgent) {
      throw new Error(`Unknown Copilot agent selection: ${requestedAgentId}`);
    }

    return selectedAgent;
  }

  /** Find an agent entry by ID, name, or fuzzy match. Returns undefined if not found. */
  findAgentEntry(agentIdOrName?: string | null): CopilotAgentCatalogEntry | undefined {
    if (!agentIdOrName) return undefined;
    if (this.agentCatalog.has(agentIdOrName)) {
      return this.agentCatalog.get(agentIdOrName);
    }
    if (agentIdOrName === 'default' || agentIdOrName === 'plain') {
      return this.agentCatalog.get(DEFAULT_COPILOT_AGENT_ID);
    }
    // Case-insensitive search by id, name, or partial match
    const lower = agentIdOrName.toLowerCase();
    for (const agent of this.agentCatalog.values()) {
      if (agent.name?.toLowerCase() === lower || agent.id?.toLowerCase() === lower) {
        return agent;
      }
    }
    return undefined;
  }

  /** Apply agent selection to a session (select or deselect). */
  async applyAgentSelection(
    session: CopilotSessionLike,
    agent: CopilotAgentCatalogEntry,
  ): Promise<void> {
    const rpcAgent = session?.rpc?.agent;

    if (agent.kind === 'default') {
      if (typeof rpcAgent?.deselect === 'function') {
        await rpcAgent.deselect();
      }
      return;
    }

    if (typeof rpcAgent?.select !== 'function') {
      throw new Error('Installed Copilot SDK does not support session.rpc.agent.select()');
    }

    await rpcAgent.select({ name: agent.name });
  }

  /** Get the current agent selection for a session. */
  async getCurrentSessionAgent(
    session: CopilotSessionLike,
  ): Promise<CurrentSessionAgentSelection> {
    const result: CopilotCurrentAgentState = await session.rpc.agent.getCurrent();
    const currentAgent = result.agent;
    if (!currentAgent) {
      return {
        agentId: null,
        agentName: null,
        agentDisplayName: null,
      };
    }

    const catalogEntry = this.findAgentEntry(currentAgent.name);
    return {
      agentId: catalogEntry?.kind === 'default' ? null : (catalogEntry?.id ?? currentAgent.name),
      agentName: catalogEntry?.name ?? currentAgent.name,
      agentDisplayName: catalogEntry?.displayName ?? currentAgent.displayName ?? null,
    };
  }

  /** Convert a CurrentSessionAgentSelection to event data fields. */
  toAgentEventData(agent: CurrentSessionAgentSelection): Record<string, unknown> {
    return {
      agentId: agent.agentId ?? DEFAULT_COPILOT_AGENT_ID,
      ...(agent.agentName ? { agentName: agent.agentName } : {}),
      ...(agent.agentDisplayName ? { agentDisplayName: agent.agentDisplayName } : {}),
    };
  }

  /** Convert a CurrentSessionAgentSelection to response data fields. */
  toAgentResponseData(agent: CurrentSessionAgentSelection): {
    agentId: string | null;
    agentName: string | null;
  } {
    return {
      agentId: agent.agentId,
      agentName: agent.agentDisplayName ?? agent.agentName,
    };
  }

  private getDefaultAgentEntry(): CopilotAgentCatalogEntry {
    const defaultAgent = this.agentCatalog.get(DEFAULT_COPILOT_AGENT_ID);
    if (!defaultAgent) {
      throw new Error('Default Copilot agent catalog entry is missing');
    }
    return defaultAgent;
  }
}
