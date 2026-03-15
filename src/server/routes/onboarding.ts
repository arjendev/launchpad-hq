import type { FastifyPluginAsync } from "fastify";
import {
  loadLaunchpadConfig,
  saveLaunchpadConfig,
} from "../state/launchpad-config.js";

const onboardingRoutes: FastifyPluginAsync = async (fastify) => {
  /** POST /api/onboarding/reset — Reset onboardingComplete so the wizard can be re-run. */
  fastify.post("/api/onboarding/reset", async () => {
    const config = await loadLaunchpadConfig();
    config.onboardingComplete = false;
    await saveLaunchpadConfig(config);
    return { ok: true, onboardingComplete: false };
  });

  /** GET /api/onboarding/status — Check whether onboarding has been completed. */
  fastify.get("/api/onboarding/status", async () => {
    const config = await loadLaunchpadConfig();
    return { onboardingComplete: config.onboardingComplete };
  });
};

export default onboardingRoutes;
