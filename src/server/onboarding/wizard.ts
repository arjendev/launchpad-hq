/**
 * Wizard engine — step sequencing, skip support, config persistence.
 * Uses @clack/prompts for clean terminal UI.
 */

import * as p from "@clack/prompts";
import type { LaunchpadConfig, WizardStep, WizardResult } from "./types.js";
import { defaultLaunchpadConfig } from "./types.js";
import { saveLaunchpadConfig } from "./config.js";

export interface WizardOptions {
  /** Steps to run in order */
  steps: WizardStep[];
  /** Whether the terminal is interactive (if false, skip all with defaults) */
  interactive?: boolean;
  /** Override config persistence (for testing) */
  onSave?: (config: LaunchpadConfig) => void | Promise<void>;
}

export async function runWizard(options: WizardOptions): Promise<WizardResult> {
  const { steps, interactive = process.stdout.isTTY ?? false } = options;
  const save = options.onSave ?? ((c: LaunchpadConfig) => saveLaunchpadConfig(c));

  let config: LaunchpadConfig = defaultLaunchpadConfig();

  // Non-interactive: apply defaults and save
  if (!interactive) {
    config.onboardingComplete = true;
    await save(config);
    return { config, skipped: true };
  }

  p.intro("🚀 Welcome to launchpad-hq!");

  const note = [
    "Let's set up your command center.",
    "You can skip any step — sensible defaults will be used.",
    "",
    `${steps.length} quick questions to get you started.`,
  ].join("\n");
  p.note(note, "First-time setup");

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const header = `[${i + 1}/${steps.length}] ${step.title}`;

    const shouldConfigure = await p.confirm({
      message: `${header} — configure now?`,
      initialValue: true,
    });

    if (p.isCancel(shouldConfigure)) {
      p.cancel("Setup cancelled. Using defaults — you can re-run later.");
      config.onboardingComplete = true;
      await save(config);
      return { config, skipped: true };
    }

    if (shouldConfigure) {
      const values = await step.prompt();

      if (p.isCancel(values)) {
        p.cancel("Setup cancelled. Using defaults — you can re-run later.");
        config.onboardingComplete = true;
        await save(config);
        return { config, skipped: true };
      }

      const error = step.validate(values);
      if (error) {
        p.log.warning(error);
        p.log.info("Using default for this step.");
      } else {
        config = step.apply(config, values);
      }
    } else {
      p.log.info(`Skipped — using default.`);
    }
  }

  config.onboardingComplete = true;
  await save(config);

  p.outro("✅ Setup complete! Launching your command center…");

  return { config, skipped: false };
}
