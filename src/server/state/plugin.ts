import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { GitStateManager } from "./state-manager.js";
import { LocalStateManager } from "./local-state-manager.js";
import {
  loadLaunchpadConfig,
  saveBootstrapConfig,
} from "./launchpad-config.js";
import type { StateService, LaunchpadConfig } from "./types.js";
import { defaultLaunchpadConfig } from "./types.js";

interface StateSnapshot {
  config: Awaited<ReturnType<StateService["getConfig"]>>;
  preferences: Awaited<ReturnType<StateService["getPreferences"]>>;
  enrichment: Awaited<ReturnType<StateService["getEnrichment"]>>;
  launchpadConfig: LaunchpadConfig;
}

declare module "fastify" {
  interface FastifyInstance {
    stateService: StateService;
    launchpadConfig: LaunchpadConfig;
    /** Hot-swap the active StateService after a stateMode change. */
    reinitializeStateService: (config: LaunchpadConfig) => Promise<void>;
  }
}

/**
 * Build the appropriate StateService for the given config.
 * Calls sync() to warm cache / ensure directories exist.
 * Returns empty defaults if the state repo is missing or has no data.
 */
async function buildStateService(
  fastify: FastifyInstance,
  lpConfig: LaunchpadConfig,
): Promise<StateService> {
  if (lpConfig.stateMode === "git") {
    const { githubToken, githubUser } = fastify;
    const { owner, repo } = resolveStateRepoTarget(
      githubUser.login,
      lpConfig.stateRepo,
    );

    const gitManager = new GitStateManager({
      token: githubToken,
      owner,
      repo,
    });

    try {
      await gitManager.sync();
      fastify.log.info("State synced from launchpad-state repo (git mode)");
    } catch (err) {
      fastify.log.warn(
        { err },
        "Failed to sync state — will use defaults / cached data",
      );
    }

    return gitManager;
  }

  // Local mode — filesystem only, no GitHub dependency for state
  const localManager = new LocalStateManager();

  try {
    await localManager.sync();
    fastify.log.info("State ready (local mode)");
  } catch (err) {
    fastify.log.warn(
      { err },
      "Failed to initialize local state directory",
    );
  }

  return localManager;
}

function resolveStateRepoTarget(
  fallbackOwner: string,
  stateRepo?: string,
): { owner: string; repo?: string } {
  if (!stateRepo) {
    return { owner: fallbackOwner };
  }

  const parts = stateRepo.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1] };
  }

  return { owner: fallbackOwner, repo: parts[0] };
}

async function captureStateSnapshot(
  stateService: StateService,
  currentLpConfig: LaunchpadConfig,
): Promise<StateSnapshot> {
  const [config, preferences, enrichment] = await Promise.all([
    stateService.getConfig(),
    stateService.getPreferences(),
    stateService.getEnrichment(),
  ]);

  return { config, preferences, enrichment, launchpadConfig: currentLpConfig };
}

async function migrateStateSnapshot(
  fastify: FastifyInstance,
  stateService: StateService,
  snapshot: StateSnapshot,
): Promise<void> {
  await Promise.all([
    stateService.saveConfig(snapshot.config),
    stateService.savePreferences(snapshot.preferences),
    stateService.saveEnrichment(snapshot.enrichment),
    stateService.saveLaunchpadConfig(snapshot.launchpadConfig),
  ]);
  try {
    await stateService.sync();
  } catch (err) {
    fastify.log.warn(
      { err },
      "Failed to sync migrated state after backend switch",
    );
  }
}

/**
 * Resolve the effective LaunchpadConfig.
 * In git mode the full config lives in the state repo; bootstrap fields
 * (stateMode, stateRepo) always come from the local file.
 */
async function resolveFullLaunchpadConfig(
  localConfig: LaunchpadConfig,
  stateService: StateService,
): Promise<LaunchpadConfig> {
  if (localConfig.stateMode !== "git") return localConfig;

  const defaults = defaultLaunchpadConfig();
  const remote = await stateService.getLaunchpadConfig();
  return {
    ...defaults,
    ...remote,
    // Deep-merge nested objects
    copilot: { ...defaults.copilot, ...(remote.copilot ?? {}) },
    tunnel: { ...defaults.tunnel, ...(remote.tunnel ?? {}) },
    // Bootstrap fields ALWAYS come from local
    version: 1,
    stateMode: localConfig.stateMode,
    stateRepo: localConfig.stateRepo,
  };
}

async function statePlugin(fastify: FastifyInstance) {
  const localConfig = await loadLaunchpadConfig();

  const stateManager = await buildStateService(fastify, localConfig);

  // In git mode, read the full config from the state repo
  const lpConfig = await resolveFullLaunchpadConfig(localConfig, stateManager);

  fastify.decorate("launchpadConfig", lpConfig);
  fastify.decorate("stateService", stateManager);

  fastify.decorate(
    "reinitializeStateService",
    async (newConfig: LaunchpadConfig) => {
      const shouldMigrateState =
        fastify.launchpadConfig.stateMode === "local" &&
        newConfig.stateMode === "git";
      const stateSnapshot = shouldMigrateState
        ? await captureStateSnapshot(fastify.stateService, fastify.launchpadConfig)
        : null;

      const newService = await buildStateService(fastify, newConfig);

      if (stateSnapshot) {
        await migrateStateSnapshot(fastify, newService, stateSnapshot);
      }

      // In git mode, write bootstrap-only locally and full config to state repo
      if (newConfig.stateMode === "git") {
        await saveBootstrapConfig({
          version: 1,
          stateMode: newConfig.stateMode,
          stateRepo: newConfig.stateRepo,
        });
        // If we didn't migrate (which already saved), save launchpad config to state repo
        if (!stateSnapshot) {
          await newService.saveLaunchpadConfig(newConfig);
        }
      }

      fastify.stateService = newService;
      fastify.launchpadConfig = newConfig;
      fastify.log.info(
        `State service reinitialized (mode: ${newConfig.stateMode})`,
      );
    },
  );
}

export default fp(statePlugin, {
  name: "state",
  dependencies: ["github-auth"],
});
