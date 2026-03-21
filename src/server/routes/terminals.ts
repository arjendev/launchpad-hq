/**
 * REST endpoints for daemon terminal management.
 *
 * POST   /api/daemons/:owner/:repo/terminal           — Spawn a new terminal
 * DELETE /api/daemons/:owner/:repo/terminal/:termId    — Kill a terminal
 * GET    /api/daemons/:owner/:repo/terminals           — List active terminals
 */

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';

/** Encapsulated tracker for terminal IDs per daemon. */
export class TerminalTracker {
  private readonly terminals = new Map<string, Set<string>>();

  add(daemonId: string, terminalId: string): void {
    let set = this.terminals.get(daemonId);
    if (!set) {
      set = new Set();
      this.terminals.set(daemonId, set);
    }
    set.add(terminalId);
  }

  remove(daemonId: string, terminalId: string): void {
    const set = this.terminals.get(daemonId);
    if (set) {
      set.delete(terminalId);
      if (set.size === 0) this.terminals.delete(daemonId);
    }
  }

  list(daemonId: string): string[] {
    const set = this.terminals.get(daemonId);
    return set ? [...set] : [];
  }

  clear(): void {
    this.terminals.clear();
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    terminalTracker: TerminalTracker;
  }
}

/** Build daemon ID from route params */
function daemonId(params: { owner: string; repo: string }): string {
  return `${params.owner}/${params.repo}`;
}

const terminalRoutes: FastifyPluginAsync = async (server) => {
  const tracker = new TerminalTracker();
  server.decorate('terminalTracker', tracker);

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

    // Validate cols/rows if provided
    if (cols !== undefined && (!Number.isInteger(cols) || cols < 1 || cols > 500)) {
      return reply.status(400).send({ error: 'bad_request', message: 'cols must be an integer between 1 and 500' });
    }
    if (rows !== undefined && (!Number.isInteger(rows) || rows < 1 || rows > 200)) {
      return reply.status(400).send({ error: 'bad_request', message: 'rows must be an integer between 1 and 200' });
    }

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

    tracker.add(id, terminalId);

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

    tracker.remove(id, termId);

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

    const terminalIds = tracker.list(id);

    return reply.send({ terminalIds });
  });
};

/** For testing: clear the in-memory terminal tracking */
export function clearTerminalTracking(): void {
  // Backward compat — tests that call this function directly
  // will still work, though they should prefer server.terminalTracker.clear()
}

export default terminalRoutes;
