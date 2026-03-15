import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { LaunchpadConfig, BootstrapConfig } from "./types.js";
import { defaultLaunchpadConfig } from "./types.js";

const CONFIG_DIR = join(homedir(), ".launchpad");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/**
 * Read the top-level launchpad config from ~/.launchpad/config.json.
 * Returns the default config if the file doesn't exist.
 *
 * In local mode this contains the full config.
 * In git mode this may only contain bootstrap fields — use
 * `loadFullLaunchpadConfig()` or read from the state service instead.
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
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Read just the bootstrap fields from ~/.launchpad/config.json.
 * Always reads from local disk — never from the state repo.
 */
export async function loadBootstrapConfig(
  configPath?: string,
): Promise<BootstrapConfig> {
  const path = configPath ?? CONFIG_PATH;
  if (!existsSync(path)) return { version: 1, stateMode: "local" };
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<BootstrapConfig>;
    return {
      version: 1,
      stateMode: parsed.stateMode === "git" ? "git" : "local",
      ...(parsed.stateRepo ? { stateRepo: parsed.stateRepo } : {}),
    };
  } catch {
    return { version: 1, stateMode: "local" };
  }
}

/**
 * Write only bootstrap fields (stateMode, stateRepo) to ~/.launchpad/config.json.
 * Used in git mode so the local file is minimal — full config lives in the state repo.
 */
export async function saveBootstrapConfig(
  bootstrap: BootstrapConfig,
  configPath?: string,
): Promise<void> {
  const path = configPath ?? CONFIG_PATH;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const data: BootstrapConfig = {
    version: 1,
    stateMode: bootstrap.stateMode,
    ...(bootstrap.stateRepo ? { stateRepo: bootstrap.stateRepo } : {}),
  };
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export { CONFIG_PATH as LAUNCHPAD_CONFIG_PATH };
