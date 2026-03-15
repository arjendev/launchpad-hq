/**
 * Config file helpers for onboarding.
 * Re-exports from Romilly's state/launchpad-config module for convenience,
 * plus a synchronous configExists() for the CLI entry point.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export {
  loadLaunchpadConfig,
  saveLaunchpadConfig,
  LAUNCHPAD_CONFIG_PATH,
} from "../state/launchpad-config.js";

export function getConfigDir(): string {
  return join(homedir(), ".launchpad");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

/** Synchronous check — used in cli.ts before async code runs. */
export function configExists(): boolean {
  return existsSync(getConfigPath());
}
