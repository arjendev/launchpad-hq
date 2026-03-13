/**
 * Self-daemon Fastify plugin.
 *
 * Spawns HQ's own daemon as a child process once the server is listening.
 * Disabled by setting LAUNCHPAD_SELF_DAEMON=false.
 */

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { generateDaemonToken } from "../../shared/auth.js";
import {
  SelfDaemonSpawner,
  detectProjectId,
  type SelfDaemonConfig,
} from "./spawner.js";

declare module "fastify" {
  interface FastifyInstance {
    selfDaemon: SelfDaemonSpawner;
  }
}

export interface SelfDaemonPluginOptions {
  /** Override project ID detection */
  projectId?: string;
  /** Override the daemon token */
  token?: string;
  /** Override enabled flag (default: reads LAUNCHPAD_SELF_DAEMON env) */
  enabled?: boolean;
}

async function selfDaemonPlugin(
  fastify: FastifyInstance,
  options: SelfDaemonPluginOptions,
) {
  const enabled =
    options.enabled ?? process.env.LAUNCHPAD_SELF_DAEMON !== "false";

  const token = options.token ?? generateDaemonToken();
  const projectId = options.projectId ?? detectProjectId();

  // Build the HQ URL once the server is ready.
  // At registration time we don't know the port yet, so we defer.
  let spawner: SelfDaemonSpawner;

  const config: SelfDaemonConfig = {
    hqUrl: "", // resolved on 'listening'
    token,
    projectId,
    enabled,
  };

  spawner = new SelfDaemonSpawner({ config, logger: fastify.log });
  fastify.decorate("selfDaemon", spawner);

  // ── Auto-register as a project in state ──────────────
  async function ensureProjectRegistered(): Promise<void> {
    if (!("stateService" in fastify)) return;

    try {
      const stateConfig = await fastify.stateService.getConfig();
      const [owner, repo] = projectId.split("/");
      if (!owner || !repo) return;

      const exists = stateConfig.projects.some(
        (p) =>
          p.owner.toLowerCase() === owner.toLowerCase() &&
          p.repo.toLowerCase() === repo.toLowerCase(),
      );

      if (!exists) {
        stateConfig.projects.push({
          owner,
          repo,
          addedAt: new Date().toISOString(),
          runtimeTarget: "local",
          initialized: false,
          daemonToken: token,
          workState: "stopped",
        });
        await fastify.stateService.saveConfig(stateConfig);
        fastify.log.info({ projectId }, "Self-daemon project auto-registered");
      }
    } catch (err) {
      fastify.log.warn(
        { err },
        "Could not auto-register self-daemon project — continuing anyway",
      );
    }
  }

  // ── Lifecycle ────────────────────────────────────────
  fastify.addHook("onReady", async () => {
    if (!enabled) return;

    const address = fastify.server.address();
    const port =
      typeof address === "object" && address ? address.port : 3000;
    config.hqUrl = `ws://localhost:${port}`;

    await ensureProjectRegistered();
    await spawner.start();
  });

  fastify.addHook("onClose", async () => {
    await spawner.stop();
  });
}

export default fp(selfDaemonPlugin, {
  name: "self-daemon",
  dependencies: ["daemon-registry"],
});
