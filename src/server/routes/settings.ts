import type { FastifyPluginAsync } from "fastify";
import type { LaunchpadConfig } from "../state/types.js";
import {
  loadLaunchpadConfig,
  saveLaunchpadConfig,
} from "../state/launchpad-config.js";
import { getGitHubToken } from "../github/auth.js";

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  /** Return the current launchpad settings. */
  fastify.get("/api/settings", async () => {
    return loadLaunchpadConfig();
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

        return { valid: true };
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
        // Deep-merge tunnel sub-object so partial updates don't lose fields
        tunnel: {
          ...current.tunnel,
          ...(body.tunnel ?? {}),
        },
        version: 1, // always pin version
      };

      await saveLaunchpadConfig(updated);

      // Detect tunnel mode change and start/stop accordingly
      const tunnelModeChanged =
        body.tunnel?.mode !== undefined &&
        body.tunnel.mode !== current.tunnel.mode;

      let tunnelStatus = undefined;

      if (tunnelModeChanged && fastify.tunnelManager) {
        if (updated.tunnel.mode === "always") {
          try {
            const port = Number(process.env.PORT) || 3000;
            await fastify.tunnelManager.start(port);
            updated.tunnel.configured = true;
            await saveLaunchpadConfig(updated);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to start tunnel";
            updated.tunnel.configured = false;
            await saveLaunchpadConfig(updated);
            fastify.log.warn(`Tunnel start failed on settings change: ${message}`);
          }
        } else if (updated.tunnel.mode === "on-demand") {
          try {
            await fastify.tunnelManager.stop();
            updated.tunnel.configured = false;
            await saveLaunchpadConfig(updated);
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
