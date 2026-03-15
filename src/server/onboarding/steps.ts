/**
 * Placeholder onboarding steps.
 * Each step registers with just a title — actual prompt logic comes from #41-#44.
 */

import type { LaunchpadConfig, WizardStep } from "./types.js";

/**
 * Creates a placeholder step that skips with defaults.
 * Real implementations will replace prompt/validate/apply.
 */
function placeholderStep(id: string, title: string): WizardStep {
  return {
    id,
    title,
    async prompt() {
      return {};
    },
    validate() {
      return null;
    },
    apply(config: LaunchpadConfig) {
      return config;
    },
  };
}

export const stateModeStep = placeholderStep("state-mode", "State Management Mode");
export const copilotPrefStep = placeholderStep("copilot-pref", "Copilot Session Preference");
export const modelStep = placeholderStep("model", "Default AI Model");
export const devtunnelStep = placeholderStep("devtunnel", "Dev Tunnel Configuration");

export const defaultSteps: WizardStep[] = [
  stateModeStep,
  copilotPrefStep,
  modelStep,
  devtunnelStep,
];
