/**
 * REST endpoints for daemon terminal management.
 *
 * POST   /api/daemons/:owner/:repo/terminal           — Spawn a new terminal
 * DELETE /api/daemons/:owner/:repo/terminal/:termId    — Kill a terminal
 * GET    /api/daemons/:owner/:repo/terminals           — List active terminals
 */

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';

// In-memory tracking of terminal IDs per daemon (HQ doesn't own PTYs,
// but tracks what we've asked the daemon to spawn)
const daemonTerminals = new Map<string, Set<string>>();

/** Build daemon ID from route params */
function daemonId(params: { owner: string; repo: string }): string {
  return `${params.owner}/${params.repo}`;
}

const terminalRoutes: FastifyPluginAsync = async (server) => {
  /** POST /api/daemons/:owner/:repo/terminal — spawn a new terminal on the daemon */
  server.post<{
    Params: { owner: string; repo: string };
    Body: { cols?: number; rows?: number };
  }>('/api/daemons/:owner/:repo/terminal', async (request, reply) => {
    const id = daemonId(request.params);

    const daemon = server.daemonRegistry.getDaemon(id);
    if (!daemon) {
      return reply.status(404).send({ error: 'not_found', message: 'Daemon not found' });
    }

    const terminalId = randomUUID();
    const { cols, rows } = request.body ?? {};

    const sent = server.daemonRegistry.sendToDaemon(id, {
      type: 'terminal-spawn',
      timestamp: Date.now(),
      payload: {
        projectId: daemon.info.projectId,
        terminalId,
        cols,
        rows,
      },
    });

    if (!sent) {
      return reply.status(502).send({ error: 'send_failed', message: 'Daemon not connected' });
    }

    // Track the terminal ID
    let terminals = daemonTerminals.get(id);
    if (!terminals) {
      terminals = new Set();
      daemonTerminals.set(id, terminals);
    }
    terminals.add(terminalId);

    return reply.status(201).send({ terminalId });
  });

  /** DELETE /api/daemons/:owner/:repo/terminal/:termId — kill a terminal */
  server.delete<{
    Params: { owner: string; repo: string; termId: string };
  }>('/api/daemons/:owner/:repo/terminal/:termId', async (request, reply) => {
    const id = daemonId(request.params);
    const { termId } = request.params;

    const daemon = server.daemonRegistry.getDaemon(id);
    if (!daemon) {
      return reply.status(404).send({ error: 'not_found', message: 'Daemon not found' });
    }

    const sent = server.daemonRegistry.sendToDaemon(id, {
      type: 'terminal-kill',
      timestamp: Date.now(),
      payload: {
        projectId: daemon.info.projectId,
        terminalId: termId,
      },
    });

    if (!sent) {
      return reply.status(502).send({ error: 'send_failed', message: 'Daemon not connected' });
    }

    // Remove from tracking
    const terminals = daemonTerminals.get(id);
    if (terminals) {
      terminals.delete(termId);
      if (terminals.size === 0) daemonTerminals.delete(id);
    }

    return reply.send({ ok: true });
  });

  /** GET /api/daemons/:owner/:repo/terminals — list active terminal IDs */
  server.get<{
    Params: { owner: string; repo: string };
  }>('/api/daemons/:owner/:repo/terminals', async (request, reply) => {
    const id = daemonId(request.params);

    const daemon = server.daemonRegistry.getDaemon(id);
    if (!daemon) {
      return reply.status(404).send({ error: 'not_found', message: 'Daemon not found' });
    }

    const terminals = daemonTerminals.get(id);
    const terminalIds = terminals ? [...terminals] : [];

    return reply.send({ terminalIds });
  });
};

/** For testing: clear the in-memory terminal tracking */
export function clearTerminalTracking(): void {
  daemonTerminals.clear();
}

export default terminalRoutes;
