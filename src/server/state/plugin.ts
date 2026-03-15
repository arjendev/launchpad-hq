import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { GitStateManager } from "./state-manager.js";
import { LocalStateManager } from "./local-state-manager.js";
import { loadLaunchpadConfig } from "./launchpad-config.js";
import type { StateService, LaunchpadConfig } from "./types.js";

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

    const repoName = lpConfig.stateRepo
      ? lpConfig.stateRepo.split("/").pop()
      : undefined;

    const gitManager = new GitStateManager({
      token: githubToken,
      owner: githubUser.login,
      repo: repoName,
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

async function statePlugin(fastify: FastifyInstance) {
  const lpConfig = await loadLaunchpadConfig();
  fastify.decorate("launchpadConfig", lpConfig);

  const stateManager = await buildStateService(fastify, lpConfig);
  fastify.decorate("stateService", stateManager);

  fastify.decorate(
    "reinitializeStateService",
    async (newConfig: LaunchpadConfig) => {
      const newService = await buildStateService(fastify, newConfig);
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
