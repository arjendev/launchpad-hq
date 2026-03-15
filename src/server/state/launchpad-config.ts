import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { LaunchpadConfig } from "./types.js";
import { defaultLaunchpadConfig } from "./types.js";

const CONFIG_DIR = join(homedir(), ".launchpad");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/**
 * Read the top-level launchpad config from ~/.launchpad/config.json.
 * Returns the default config if the file doesn't exist.
 */
export async function loadLaunchpadConfig(
  configPath?: string,
): Promise<LaunchpadConfig> {
  const path = configPath ?? CONFIG_PATH;
  if (!existsSync(path)) return defaultLaunchpadConfig();
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LaunchpadConfig>;
    const defaults = defaultLaunchpadConfig();
    return {
      ...defaults,
      ...parsed,
      // Deep-merge nested objects so partial configs retain defaults
      copilot: {
        ...defaults.copilot,
        ...(parsed.copilot ?? {}),
      },
      tunnel: {
        ...defaults.tunnel,
        ...(parsed.tunnel ?? {}),
      },
    };
  } catch {
    return defaultLaunchpadConfig();
  }
}

/**
 * Persist the launchpad config to ~/.launchpad/config.json.
 */
export async function saveLaunchpadConfig(
  config: LaunchpadConfig,
  configPath?: string,
): Promise<void> {
  const path = configPath ?? CONFIG_PATH;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export { CONFIG_PATH as LAUNCHPAD_CONFIG_PATH };
