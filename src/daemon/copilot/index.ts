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

export { MockCopilotAdapter } from './mock-adapter.js';
export { SdkCopilotAdapter } from './sdk-adapter.js';
export { CopilotManager } from './manager.js';
export type { CopilotManagerOptions, SendToHq } from './manager.js';
