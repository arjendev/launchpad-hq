export { GitStateManager, StateManager, type StateManagerOptions, type StateManagerDeps } from "./state-manager.js";
export { LocalStateManager, type LocalStateManagerOptions } from "./local-state-manager.js";
export { GitHubStateClient, ShaConflictError } from "./github-state-client.js";
export { LocalCache } from "./local-cache.js";
export {
  loadLaunchpadConfig,
  saveLaunchpadConfig,
  loadBootstrapConfig,
  saveBootstrapConfig,
  LAUNCHPAD_CONFIG_PATH,
} from "./launchpad-config.js";
export type {
  ProjectConfig,
  ProjectEntry,
  UserPreferences,
  EnrichmentData,
  ProjectEnrichmentEntry,
  StateService,
  LaunchpadConfig,
  BootstrapConfig,
} from "./types.js";
export {
  defaultProjectConfig,
  defaultUserPreferences,
  defaultEnrichmentData,
  defaultLaunchpadConfig,
} from "./types.js";
export { default as statePlugin } from "./plugin.js";
