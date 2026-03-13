import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { StateManager } from "./state-manager.js";
import type { StateService } from "./types.js";

declare module "fastify" {
  interface FastifyInstance {
    stateService: StateService;
  }
}

async function statePlugin(fastify: FastifyInstance) {
  const { githubToken, githubUser } = fastify;

  const stateManager = new StateManager({
    token: githubToken,
    owner: githubUser.login,
  });

  // Warm the local cache from GitHub on startup
  try {
    await stateManager.sync();
    fastify.log.info("State synced from launchpad-state repo");
  } catch (err) {
    fastify.log.warn(
      { err },
      "Failed to sync state — will use defaults / cached data",
    );
  }

  fastify.decorate("stateService", stateManager as StateService);
}

export default fp(statePlugin, {
  name: "state",
  dependencies: ["github-auth"],
});
