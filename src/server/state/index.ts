export { StateManager, type StateManagerOptions, type StateManagerDeps } from "./state-manager.js";
export { GitHubStateClient } from "./github-state-client.js";
export { LocalCache } from "./local-cache.js";
export type {
  ProjectConfig,
  ProjectEntry,
  UserPreferences,
  EnrichmentData,
  ProjectEnrichmentEntry,
  StateService,
} from "./types.js";
export {
  defaultProjectConfig,
  defaultUserPreferences,
  defaultEnrichmentData,
} from "./types.js";
export { default as statePlugin } from "./plugin.js";
