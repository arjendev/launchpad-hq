import type { FastifyPluginAsync } from "fastify";
import type { LaunchpadConfig } from "../state/types.js";
import { defaultLaunchpadConfig } from "../state/types.js";
import {
  loadLaunchpadConfig,
  saveLaunchpadConfig,
  saveBootstrapConfig,
} from "../state/launchpad-config.js";
import { getGitHubToken } from "../github/auth.js";
import { checkRepo } from "../github/rest.js";
import { loadConfig } from "../config.js";

/**
 * Deep-merge a partial update into an existing LaunchpadConfig.
 */
function mergeConfig(
  current: LaunchpadConfig,
  body: Partial<LaunchpadConfig>,
): LaunchpadConfig {
  const defaults = defaultLaunchpadConfig();

  // Merge otel: only include if either current or body has it
  let otel: LaunchpadConfig["otel"] | undefined;
  if (body.otel !== undefined || current.otel !== undefined) {
    otel = {
      enabled: body.otel?.enabled ?? current.otel?.enabled ?? false,
      endpoint: body.otel?.endpoint ?? current.otel?.endpoint ?? "http://localhost:4317",
      ...(body.otel?.serviceName ?? current.otel?.serviceName
        ? { serviceName: body.otel?.serviceName ?? current.otel?.serviceName }
        : {}),
    };
  }

  return {
    ...current,
    ...body,
    copilot: {
      ...defaults.copilot,
      ...current.copilot,
      ...(body.copilot ?? {}),
    },
    tunnel: {
      ...defaults.tunnel,
      ...current.tunnel,
      ...(body.tunnel ?? {}),
    },
    ...(otel ? { otel } : {}),
    version: 1,
  };
}

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Return the current launchpad settings.
   * In git mode, reads from the state repo (via fastify.launchpadConfig which
   * was resolved at boot). In local mode, reads from ~/.launchpad/config.json.
   */
  fastify.get("/api/settings", async () => {
    // fastify.launchpadConfig is already resolved from the right source at boot
    // and kept up-to-date by PUT. Return it directly.
    // NOTE: sessionToken is NOT included here — the client gets it from the URL query param.
    return { ...fastify.launchpadConfig };
  });

  /** Validate a GitHub repo exists and user has write access. */
  fastify.post<{ Body: { owner: string; repo: string } }>(
    "/api/settings/validate-repo",
    async (request, reply) => {
      const { owner, repo } = request.body as { owner?: string; repo?: string };

      if (!owner || !repo) {
        return reply.status(400).send({
          valid: false,
          error: "Both owner and repo are required",
        });
      }

      let token: string;
      try {
        token = await getGitHubToken();
      } catch {
        return reply.status(500).send({
          valid: false,
          error: "GitHub authentication not available. Run: gh auth login",
        });
      }

      try {
        const validation = await checkRepo(token, owner, repo);

        if (validation.status === 404) {
          return { valid: false, error: `Repository ${owner}/${repo} not found` };
        }

        if (!validation.exists) {
          return {
            valid: false,
            error: `GitHub API error: ${validation.status}`,
          };
        }

        const hasWrite = validation.permissions?.push === true || validation.permissions?.admin === true;

        if (!hasWrite) {
          return {
            valid: false,
            error: `You do not have write access to ${owner}/${repo}`,
          };
        }

        return { valid: true, message: `Repository ${owner}/${repo} validated — you have write access.` };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({
          valid: false,
          error: `Failed to validate repo: ${message}`,
        });
      }
    },
  );

  /** Update launchpad settings. */
  fastify.put<{ Body: Partial<LaunchpadConfig> }>(
    "/api/settings",
    async (request, reply) => {
      const current = fastify.launchpadConfig;
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

      const updated = mergeConfig(current, body);

      // Detect stateMode change and hot-swap the active StateService
      const stateModeChanged =
        body.stateMode !== undefined && body.stateMode !== current.stateMode;

      if (stateModeChanged && fastify.reinitializeStateService) {
        try {
          await fastify.reinitializeStateService(updated);
          fastify.log.info(
            `State service swapped: ${current.stateMode} → ${updated.stateMode}`,
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          fastify.log.error(
            `Failed to reinitialize state service: ${message}`,
          );
        }
      } else {
        // No mode switch — persist to the appropriate backend
        if (updated.stateMode === "git") {
          // Full config to state repo, bootstrap-only locally
          await fastify.stateService.saveLaunchpadConfig(updated);
          await saveBootstrapConfig({
            version: 1,
            stateMode: updated.stateMode,
            stateRepo: updated.stateRepo,
          });
        } else {
          // Local mode — full config to ~/.launchpad/config.json
          await saveLaunchpadConfig(updated);
        }
        fastify.launchpadConfig = updated;
      }

      // Detect tunnel mode change and start/stop accordingly
      const tunnelModeChanged =
        body.tunnel?.mode !== undefined &&
        body.tunnel.mode !== current.tunnel.mode;

      let tunnelStatus = undefined;

      if (tunnelModeChanged && fastify.tunnelManager) {
        if (updated.tunnel.mode === "always") {
          try {
            const { tunnelPort } = loadConfig();
            await fastify.tunnelManager.start(tunnelPort);
            updated.tunnel.configured = true;
            // Persist the tunnel.configured update
            if (updated.stateMode === "git") {
              await fastify.stateService.saveLaunchpadConfig(updated);
            } else {
              await saveLaunchpadConfig(updated);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to start tunnel";
            updated.tunnel.configured = false;
            if (updated.stateMode === "git") {
              await fastify.stateService.saveLaunchpadConfig(updated);
            } else {
              await saveLaunchpadConfig(updated);
            }
            fastify.log.warn(`Tunnel start failed on settings change: ${message}`);
          }
        } else if (updated.tunnel.mode === "on-demand") {
          try {
            await fastify.tunnelManager.stop();
            updated.tunnel.configured = false;
            if (updated.stateMode === "git") {
              await fastify.stateService.saveLaunchpadConfig(updated);
            } else {
              await saveLaunchpadConfig(updated);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to stop tunnel";
            fastify.log.warn(`Tunnel stop failed on settings change: ${message}`);
          }
        }

        tunnelStatus = fastify.tunnelManager.getState();
      }

      return { ...updated, tunnelStatus };
    },
  );

  /** Return current OTEL configuration. */
  fastify.get("/api/settings/otel", async () => {
    const config = fastify.launchpadConfig;
    return {
      enabled: config.otel?.enabled ?? false,
      endpoint: config.otel?.endpoint ?? "http://localhost:4317",
      serviceName: config.otel?.serviceName ?? "launchpad-hq",
    };
  });

  /** Update OTEL configuration. Requires server restart to take effect. */
  fastify.put<{ Body: { enabled?: boolean; endpoint?: string; serviceName?: string } }>(
    "/api/settings/otel",
    async (request, reply) => {
      const body = request.body as { enabled?: boolean; endpoint?: string; serviceName?: string };
      const current = fastify.launchpadConfig;

      const otel = {
        enabled: body.enabled ?? current.otel?.enabled ?? false,
        endpoint: body.endpoint ?? current.otel?.endpoint ?? "http://localhost:4317",
        ...(body.serviceName ? { serviceName: body.serviceName } : {}),
      };

      const updated = mergeConfig(current, { otel });

      if (updated.stateMode === "git") {
        await fastify.stateService.saveLaunchpadConfig(updated);
        await saveBootstrapConfig({
          version: 1,
          stateMode: updated.stateMode,
          stateRepo: updated.stateRepo,
        });
      } else {
        await saveLaunchpadConfig(updated);
      }
      fastify.launchpadConfig = updated;

      return {
        ...otel,
        message: "OTEL configuration updated. Restart the server for changes to take effect.",
      };
    },
  );
};

export default settingsRoutes;
