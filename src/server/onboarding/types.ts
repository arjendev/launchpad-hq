/**
 * Onboarding wizard types — step interface and result.
 * LaunchpadConfig lives in src/server/state/types.ts (shared with Romilly's config module).
 */

import type { LaunchpadConfig } from "../state/types.js";

export type { LaunchpadConfig };
export { defaultLaunchpadConfig } from "../state/types.js";

/**
 * A single onboarding wizard step.
 * Each step collects one piece of configuration.
 */
export interface WizardStep {
  /** Unique step identifier */
  id: string;
  /** Human-readable title shown in the wizard */
  title: string;
  /** Run the interactive prompt and return the collected value. Receives current config for pre-filling. */
  prompt(currentConfig: LaunchpadConfig): Promise<Record<string, unknown>>;
  /** Validate collected values. Return null if valid, or an error message. */
  validate(values: Record<string, unknown>): string | null;
  /** Apply collected values to the config object */
  apply(config: LaunchpadConfig, values: Record<string, unknown>): LaunchpadConfig;
}

export interface WizardResult {
  config: LaunchpadConfig;
  skipped: boolean;
}
