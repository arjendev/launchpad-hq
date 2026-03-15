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
  }
}

async function statePlugin(fastify: FastifyInstance) {
  const lpConfig = await loadLaunchpadConfig();
  fastify.decorate("launchpadConfig", lpConfig);

  let stateManager: StateService;

  if (lpConfig.stateMode === "git") {
    // Git mode requires GitHub auth — plugin dependency guarantees it exists
    const { githubToken, githubUser } = fastify;
    const gitManager = new GitStateManager({
      token: githubToken,
      owner: githubUser.login,
    });

    // Warm the local cache from GitHub on startup
    try {
      await gitManager.sync();
      fastify.log.info("State synced from launchpad-state repo (git mode)");
    } catch (err) {
      fastify.log.warn(
        { err },
        "Failed to sync state — will use defaults / cached data",
      );
    }

    stateManager = gitManager;
  } else {
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

    stateManager = localManager;
  }

  fastify.decorate("stateService", stateManager);
}

export default fp(statePlugin, {
  name: "state",
  dependencies: ["github-auth"],
});
