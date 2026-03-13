/**
 * Copilot SDK integration layer — barrel export.
 */

export type {
  CopilotAdapter,
  CopilotSession,
  SessionConfig,
  ToolDefinition,
  CopilotSdkSessionInfo,
  CopilotSessionEvent,
  CopilotSdkState,
} from './adapter.js';

export { SdkCopilotAdapter, getSdkDefineTool } from './sdk-adapter.js';
export type { SdkCopilotAdapterOptions } from './sdk-adapter.js';
export { CopilotManager } from './manager.js';
export type { CopilotManagerOptions, SendToHq } from './manager.js';
export { createHqTools } from './hq-tools.js';
export { buildSystemMessage } from './system-message.js';
