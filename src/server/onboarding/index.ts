/**
 * Public API for the onboarding wizard.
 */

export { configExists, loadLaunchpadConfig, saveLaunchpadConfig, getConfigPath, getConfigDir } from "./config.js";
export { runWizard } from "./wizard.js";
export { defaultSteps, createDevtunnelStep } from "./steps.js";
export type { LaunchpadConfig, WizardStep, WizardResult } from "./types.js";
export { defaultLaunchpadConfig } from "./types.js";
export type { DevtunnelOps } from "./devtunnel-ops.js";
export { createDevtunnelOps } from "./devtunnel-ops.js";

import { configExists } from "./config.js";
import { runWizard } from "./wizard.js";
import { defaultSteps } from "./steps.js";

/**
 * Top-level entry point called from cli.ts.
 * Checks for first launch and runs the wizard if needed.
 */
export async function runOnboardingWizard(): Promise<void> {
  if (configExists()) {
    return;
  }

  await runWizard({ steps: defaultSteps });
}
