/**
 * Daemon configuration loading.
 *
 * Priority: CLI args (overrides) → environment variables → config file → defaults.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_HQ_PORT } from '../shared/constants.js';

export interface DaemonConfig {
  hqUrl: string;
  token: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  previewPort?: number;
}

interface ConfigFile {
  hq?: string;
  token?: string;
  project?: {
    id?: string;
    name?: string;
    path?: string;
  };
  preview?: {
    port?: number;
  };
}

const CONFIG_FILENAME = '.launchpad/daemon.json';

/**
 * Attempt to read a JSON config file from the project root.
 * Returns null if file doesn't exist or is invalid.
 */
export function readConfigFile(projectRoot?: string): ConfigFile | null {
  const root = projectRoot ?? process.cwd();
  const configPath = resolve(root, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as ConfigFile;
  } catch {
    return null;
  }
}

/**
 * Validate and return a complete DaemonConfig.
 * Throws if required fields are missing.
 */
export function loadDaemonConfig(overrides?: Partial<DaemonConfig>): DaemonConfig {
  const file = readConfigFile();

  const hqUrl =
    overrides?.hqUrl ??
    process.env.LAUNCHPAD_HQ_URL ??
    file?.hq ??
    `ws://localhost:${DEFAULT_HQ_PORT}`;

  const token =
    overrides?.token ??
    process.env.LAUNCHPAD_DAEMON_TOKEN ??
    file?.token;

  const projectId =
    overrides?.projectId ??
    process.env.LAUNCHPAD_PROJECT_ID ??
    file?.project?.id;

  const projectName =
    overrides?.projectName ??
    process.env.LAUNCHPAD_PROJECT_NAME ??
    file?.project?.name ??
    inferProjectName();

  const projectPath =
    overrides?.projectPath ??
    process.env.LAUNCHPAD_PROJECT_PATH ??
    file?.project?.path ??
    process.cwd();

  const previewPortRaw =
    overrides?.previewPort ??
    (process.env.LAUNCHPAD_PREVIEW_PORT ? Number(process.env.LAUNCHPAD_PREVIEW_PORT) : undefined) ??
    file?.preview?.port;
  const previewPort = previewPortRaw && Number.isFinite(previewPortRaw) ? previewPortRaw : undefined;

  if (!token) {
    throw new Error(
      'Daemon token is required. Set LAUNCHPAD_DAEMON_TOKEN or add "token" to .launchpad/daemon.json',
    );
  }

  if (!projectId) {
    throw new Error(
      'Project ID is required. Set LAUNCHPAD_PROJECT_ID or add "project.id" to .launchpad/daemon.json',
    );
  }

  return { hqUrl, token, projectId, projectName, projectPath, previewPort };
}

/** Derive a project name from the current directory basename */
function inferProjectName(): string {
  return process.cwd().split('/').pop() ?? 'unknown';
}
