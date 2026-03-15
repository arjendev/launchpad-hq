import type { FastifyPluginAsync } from "fastify";
import type { LaunchpadConfig } from "../state/types.js";
import { defaultLaunchpadConfig } from "../state/types.js";
import {
  loadLaunchpadConfig,
  saveLaunchpadConfig,
  saveBootstrapConfig,
} from "../state/launchpad-config.js";
import { getGitHubToken } from "../github/auth.js";
import { loadConfig } from "../config.js";

/**
 * Deep-merge a partial update into an existing LaunchpadConfig.
 */
function mergeConfig(
  current: LaunchpadConfig,
  body: Partial<LaunchpadConfig>,
): LaunchpadConfig {
  const defaults = defaultLaunchpadConfig();
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
        const res = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "launchpad-hq",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );

        if (res.status === 404) {
          return { valid: false, error: `Repository ${owner}/${repo} not found` };
        }

        if (!res.ok) {
          return {
            valid: false,
            error: `GitHub API error: ${res.status}`,
          };
        }

        const data = (await res.json()) as {
          permissions?: { push?: boolean; admin?: boolean };
        };

        const hasWrite = data.permissions?.push === true || data.permissions?.admin === true;

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
};

export default settingsRoutes;
