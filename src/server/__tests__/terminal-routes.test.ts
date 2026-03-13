import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestServer, type FastifyInstance } from '../../test-utils/server.js';
import { DaemonRegistry } from '../daemon-registry/registry.js';
import type { DaemonInfo } from '../../shared/protocol.js';
import terminalRoutes, { clearTerminalTracking } from '../routes/terminals.js';

function createMockSocket() {
  const sent: string[] = [];
  return {
    sent,
    readyState: 1,
    OPEN: 1 as const,
    send(data: string) {
      sent.push(data);
    },
    close() {},
    terminate() {},
    ping() {},
    on() {},
  };
}

function makeDaemonInfo(overrides?: Partial<DaemonInfo>): DaemonInfo {
  return {
    projectId: 'proj-1',
    projectName: 'Test Project',
    runtimeTarget: 'local',
    capabilities: ['terminal'],
    version: '0.1.0',
    protocolVersion: '1.0.0' as DaemonInfo['protocolVersion'],
    ...overrides,
  };
}

describe('Terminal REST routes', () => {
  let server: FastifyInstance;
  let registry: DaemonRegistry;

  beforeEach(async () => {
    clearTerminalTracking();
    server = await createTestServer();
    registry = new DaemonRegistry();
    server.decorate('daemonRegistry', registry);
    await server.register(terminalRoutes);
  });

  afterEach(async () => {
    clearTerminalTracking();
    registry.stopHeartbeatMonitor();
    await server.close();
  });

  describe('POST /api/daemons/:id/terminal', () => {
    it('spawns a terminal and returns terminalId', async () => {
      const ws = createMockSocket();
      registry.register('d1', ws as never, makeDaemonInfo());

      const res = await server.inject({
        method: 'POST',
        url: '/api/daemons/d1/terminal',
        payload: { cols: 120, rows: 40 },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.terminalId).toBeDefined();
      expect(typeof body.terminalId).toBe('string');

      // Should have sent terminal-spawn to daemon
      expect(ws.sent).toHaveLength(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe('terminal-spawn');
      expect(msg.payload.terminalId).toBe(body.terminalId);
      expect(msg.payload.cols).toBe(120);
      expect(msg.payload.rows).toBe(40);
    });

    it('works without cols/rows', async () => {
      const ws = createMockSocket();
      registry.register('d1', ws as never, makeDaemonInfo());

      const res = await server.inject({
        method: 'POST',
        url: '/api/daemons/d1/terminal',
        payload: {},
      });

      expect(res.statusCode).toBe(201);
    });

    it('returns 404 for unknown daemon', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/daemons/ghost/terminal',
        payload: {},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    it('returns 502 when daemon is disconnected', async () => {
      const ws = createMockSocket();
      ws.readyState = 3; // CLOSED
      registry.register('d1', ws as never, makeDaemonInfo());

      const res = await server.inject({
        method: 'POST',
        url: '/api/daemons/d1/terminal',
        payload: {},
      });

      expect(res.statusCode).toBe(502);
    });
  });

  describe('DELETE /api/daemons/:id/terminal/:termId', () => {
    it('kills a terminal', async () => {
      const ws = createMockSocket();
      registry.register('d1', ws as never, makeDaemonInfo());

      // First spawn a terminal
      const spawnRes = await server.inject({
        method: 'POST',
        url: '/api/daemons/d1/terminal',
        payload: {},
      });
      const { terminalId } = spawnRes.json();

      // Reset sent messages
      ws.sent.length = 0;

      // Kill it
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/daemons/d1/terminal/${terminalId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      // Should have sent terminal-kill to daemon
      expect(ws.sent).toHaveLength(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe('terminal-kill');
      expect(msg.payload.terminalId).toBe(terminalId);
    });

    it('returns 404 for unknown daemon', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: '/api/daemons/ghost/terminal/t1',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 502 when daemon is disconnected', async () => {
      const ws = createMockSocket();
      ws.readyState = 3; // CLOSED
      registry.register('d1', ws as never, makeDaemonInfo());

      const res = await server.inject({
        method: 'DELETE',
        url: '/api/daemons/d1/terminal/t1',
      });

      expect(res.statusCode).toBe(502);
    });
  });

  describe('GET /api/daemons/:id/terminals', () => {
    it('lists terminal IDs for a daemon', async () => {
      const ws = createMockSocket();
      registry.register('d1', ws as never, makeDaemonInfo());

      // Spawn two terminals
      const res1 = await server.inject({
        method: 'POST',
        url: '/api/daemons/d1/terminal',
        payload: {},
      });
      const res2 = await server.inject({
        method: 'POST',
        url: '/api/daemons/d1/terminal',
        payload: {},
      });

      const listRes = await server.inject({
        method: 'GET',
        url: '/api/daemons/d1/terminals',
      });

      expect(listRes.statusCode).toBe(200);
      const body = listRes.json();
      expect(body.terminalIds).toHaveLength(2);
      expect(body.terminalIds).toContain(res1.json().terminalId);
      expect(body.terminalIds).toContain(res2.json().terminalId);
    });

    it('returns empty list when no terminals exist', async () => {
      const ws = createMockSocket();
      registry.register('d1', ws as never, makeDaemonInfo());

      const res = await server.inject({
        method: 'GET',
        url: '/api/daemons/d1/terminals',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().terminalIds).toEqual([]);
    });

    it('returns 404 for unknown daemon', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/daemons/ghost/terminals',
      });

      expect(res.statusCode).toBe(404);
    });

    it('reflects killed terminals', async () => {
      const ws = createMockSocket();
      registry.register('d1', ws as never, makeDaemonInfo());

      // Spawn and kill
      const spawnRes = await server.inject({
        method: 'POST',
        url: '/api/daemons/d1/terminal',
        payload: {},
      });
      const { terminalId } = spawnRes.json();

      await server.inject({
        method: 'DELETE',
        url: `/api/daemons/d1/terminal/${terminalId}`,
      });

      const listRes = await server.inject({
        method: 'GET',
        url: '/api/daemons/d1/terminals',
      });

      expect(listRes.json().terminalIds).toEqual([]);
    });
  });
});
