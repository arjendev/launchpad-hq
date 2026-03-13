// Public API for the Copilot introspection module
export { default as copilotPlugin } from "./plugin.js";
export { CopilotSessionManager } from "./session-manager.js";
export { MockCopilotAdapter } from "./mock-adapter.js";
export type {
  CopilotAdapter,
  CopilotSession,
  CopilotSessionSummary,
  ConversationMessage,
  ConversationRole,
  SessionChangeEvent,
  SessionStatus,
} from "./types.js";
