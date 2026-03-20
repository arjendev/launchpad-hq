/**
 * Copilot SDK integration layer — barrel export.
 */

export { CopilotManager } from './manager.js';
export type { CopilotManagerOptions, SendToHq } from './manager.js';
export { createHqTools } from './hq-tools.js';
export { buildSystemMessage } from './system-message.js';
export {
  DEFAULT_COPILOT_AGENT_ID,
  createDefaultCopilotAgentCatalogEntry,
  discoverCopilotAgents,
} from './agent-catalog.js';
export type { DiscoveredCopilotAgents } from './agent-catalog.js';
export { CoordinatorSessionManager } from './coordinator.js';
export type { CoordinatorOptions, CoordinatorSnapshot } from './coordinator.js';
export { IssueDispatcher } from './dispatch.js';
export type { DispatchResult, DispatchedIssue } from './dispatch.js';
