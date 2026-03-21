// ────────────────────────────────────────────────────────
// Shared validation helpers (de-duplicated from route modules)
// ────────────────────────────────────────────────────────

export const OWNER_REPO_REGEX = /^[a-zA-Z0-9_.-]+$/;

/** Validate that a string is a valid GitHub owner or repo name segment. */
export function isValidOwnerRepo(value: string): boolean {
  return OWNER_REPO_REGEX.test(value) && value.length > 0 && value.length <= 100;
}

/**
 * Derive daemon connection info for a project.
 * Returns status + optional lastSeen heartbeat timestamp.
 */
export function deriveDaemonInfo(
  fastify: { daemonRegistry: { getAllDaemons(): Array<{ projectId: string; state: string; lastHeartbeat: number }> } },
  owner: string,
  repo: string,
): { daemonStatus: "online" | "offline"; lastSeen?: number } {
  const projectId = `${owner}/${repo}`;
  const daemons = fastify.daemonRegistry.getAllDaemons();
  const daemon = daemons.find(
    (d) => d.projectId.toLowerCase() === projectId.toLowerCase() && d.state === "connected",
  );
  if (daemon) {
    return { daemonStatus: "online", lastSeen: daemon.lastHeartbeat };
  }
  return { daemonStatus: "offline" };
}

/** Shortcut: derive only the status string (no lastSeen). */
export function deriveDaemonStatus(
  fastify: { daemonRegistry: { getAllDaemons(): Array<{ projectId: string; state: string; lastHeartbeat: number }> } },
  owner: string,
  repo: string,
): "online" | "offline" {
  return deriveDaemonInfo(fastify, owner, repo).daemonStatus;
}
