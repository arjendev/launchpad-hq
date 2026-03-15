import type { FastifyPluginAsync } from "fastify";
import type { LaunchpadConfig } from "../state/types.js";
import {
  loadLaunchpadConfig,
  saveLaunchpadConfig,
} from "../state/launchpad-config.js";

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  /** Return the current launchpad settings. */
  fastify.get("/api/settings", async () => {
    return loadLaunchpadConfig();
  });

  /** Update launchpad settings. */
  fastify.put<{ Body: Partial<LaunchpadConfig> }>(
    "/api/settings",
    async (request, reply) => {
      const current = await loadLaunchpadConfig();
      const body = request.body as Partial<LaunchpadConfig>;

      if (
        body.stateMode !== undefined &&
        body.stateMode !== "local" &&
        body.stateMode !== "git"
      ) {
        return reply
          .status(400)
          .send({ error: 'stateMode must be "local" or "git"' });
      }

      const updated: LaunchpadConfig = {
        ...current,
        ...body,
        version: 1, // always pin version
      };

      await saveLaunchpadConfig(updated);

      return updated;
    },
  );
};

export default settingsRoutes;
