/**
 * Copilot SDK integration layer — barrel export.
 */

export { CopilotManager } from './manager.js';
export type { CopilotManagerOptions } from './manager.js';
export type { SendToHq } from '../../shared/protocol.js';
export { createHqTools } from './hq-tools.js';
export { buildSystemMessage } from './system-message.js';
export {
  DEFAULT_COPILOT_AGENT_ID,
  createDefaultCopilotAgentCatalogEntry,
  discoverCopilotAgents,
} from './agent-catalog.js';
export type { DiscoveredCopilotAgents } from './agent-catalog.js';
export { AgentResolver } from './agent-resolver.js';
export type { CurrentSessionAgentSelection } from './agent-resolver.js';
export { ElicitationRelay } from './elicitation.js';
export { CoordinatorSessionManager } from './coordinator.js';
export type { CoordinatorOptions, CoordinatorSnapshot } from './coordinator.js';
export { IssueDispatcher } from './dispatch.js';
export type { DispatchResult } from './dispatch.js';
