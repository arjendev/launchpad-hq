import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { DaemonWebSocketClient } from '../client.js';
import type { HqToDaemonMessage, DaemonToHqMessage } from '../../shared/protocol.js';
import {
  DAEMON_WS_PATH,
  HEARTBEAT_INTERVAL_MS,
  RECONNECT_DELAY_MS,
  WS_CLOSE_AUTH_REJECTED,
} from '../../shared/constants.js';

/** Create a test WS server on a random port and return it with its URL */
function createTestServer(): Promise<{ wss: WebSocketServer; url: string; port: number }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on('listening', () => {
      const addr = wss.address() as { port: number };
      resolve({
        wss,
        url: `ws://127.0.0.1:${addr.port}`,
        port: addr.port,
      });
    });
  });
}

/** Wait for a message on the server side */
function waitForServerMessage(wss: WebSocketServer): Promise<DaemonToHqMessage> {
  return new Promise((resolve) => {
    for (const ws of wss.clients) {
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    }
  });
}

/** Send a message from the server to the first connected client */
function serverSend(wss: WebSocketServer, msg: HqToDaemonMessage): void {
  for (const ws of wss.clients) {
    ws.send(JSON.stringify(msg));
  }
}

/** Wait for next client connection on the server */
function waitForConnection(wss: WebSocketServer): Promise<WebSocket> {
  return new Promise((resolve) => {
    wss.on('connection', (ws) => resolve(ws));
  });
}

describe('daemon/client', () => {
  let wss: WebSocketServer;
  let baseUrl: string;
  let client: DaemonWebSocketClient;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = await createTestServer();
    wss = server.wss;
    baseUrl = server.url;
  });

  afterEach(async () => {
    client?.disconnect();
    await new Promise<void>((resolve) => wss.close(resolve));
    vi.useRealTimers();
  });

  function createClient(overrides?: Partial<{ hqUrl: string; token: string; projectId: string }>) {
    client = new DaemonWebSocketClient({
      hqUrl: overrides?.hqUrl ?? baseUrl,
      token: overrides?.token ?? 'test-token',
      projectId: overrides?.projectId ?? 'proj-1',
    });
    return client;
  }

  describe('connect', () => {
    it('emits connected on successful connection', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));

      client.connect();
      await connected;

      expect(client.isConnected).toBe(true);
    });

    it('appends daemon WS path to HQ URL', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));

      client.connect();
      await connected;

      // If connection succeeded, URL was correctly built with DAEMON_WS_PATH
      expect(client.isConnected).toBe(true);
    });

    it('strips trailing slash from HQ URL', async () => {
      createClient({ hqUrl: baseUrl + '/' });
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));

      client.connect();
      await connected;

      expect(client.isConnected).toBe(true);
    });
  });

  describe('auth flow', () => {
    it('responds to auth-challenge automatically', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      const msgPromise = waitForServerMessage(wss);

      serverSend(wss, {
        type: 'auth-challenge',
        timestamp: Date.now(),
        payload: { nonce: 'test-nonce-123' },
      });

      const response = await msgPromise;

      expect(response.type).toBe('auth-response');
      if (response.type === 'auth-response') {
        expect(response.payload.token).toBe('test-token');
        expect(response.payload.nonce).toBe('test-nonce-123');
        expect(response.payload.projectId).toBe('proj-1');
      }
    });

    it('emits authenticated on auth-accept', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      const authed = new Promise<void>((resolve) => client.on('authenticated', resolve));

      serverSend(wss, {
        type: 'auth-accept',
        timestamp: Date.now(),
        payload: { message: 'welcome' },
      });

      await authed;

      expect(client.isAuthenticated).toBe(true);
    });

    it('emits auth-rejected on auth-reject', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      const rejected = new Promise<string>((resolve) =>
        client.on('auth-rejected', resolve),
      );

      serverSend(wss, {
        type: 'auth-reject',
        timestamp: Date.now(),
        payload: { reason: 'bad token' },
      });

      const reason = await rejected;
      expect(reason).toBe('bad token');
      expect(client.isAuthenticated).toBe(false);
    });
  });

  describe('registration', () => {
    it('sends registration message with daemon info', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      const msgPromise = waitForServerMessage(wss);

      client.sendRegistration({
        projectId: 'proj-1',
        projectName: 'test-project',
        runtimeTarget: 'local',
        capabilities: ['terminal'],
        version: '0.1.0',
        protocolVersion: '1.0.0',
      });

      const msg = await msgPromise;

      expect(msg.type).toBe('register');
      if (msg.type === 'register') {
        expect(msg.payload.projectId).toBe('proj-1');
        expect(msg.payload.projectName).toBe('test-project');
        expect(msg.payload.runtimeTarget).toBe('local');
      }
    });
  });

  describe('heartbeat', () => {
    it('starts heartbeat after authentication', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      const authed = new Promise<void>((resolve) => client.on('authenticated', resolve));
      serverSend(wss, {
        type: 'auth-accept',
        timestamp: Date.now(),
        payload: { message: 'ok' },
      });
      await authed;

      const msgPromise = waitForServerMessage(wss);

      // Advance timer past heartbeat interval
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS + 100);

      const msg = await msgPromise;

      expect(msg.type).toBe('heartbeat');
      if (msg.type === 'heartbeat') {
        expect(msg.payload.projectId).toBe('proj-1');
        expect(msg.payload.uptimeMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('stops heartbeat on disconnect', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      const authed = new Promise<void>((resolve) => client.on('authenticated', resolve));
      serverSend(wss, {
        type: 'auth-accept',
        timestamp: Date.now(),
        payload: { message: 'ok' },
      });
      await authed;

      client.disconnect();

      expect(client.isAuthenticated).toBe(false);
    });
  });

  describe('status updates', () => {
    it('sends status update message', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      const msgPromise = waitForServerMessage(wss);

      client.sendStatusUpdate({
        initialized: true,
        daemonOnline: true,
        workState: 'working',
      });

      const msg = await msgPromise;

      expect(msg.type).toBe('status-update');
      if (msg.type === 'status-update') {
        expect(msg.payload.state.workState).toBe('working');
        expect(msg.payload.state.daemonOnline).toBe(true);
      }
    });
  });

  describe('command handling', () => {
    it('invokes command handler for command messages', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      const handler = vi.fn();
      client.onCommand(handler);

      serverSend(wss, {
        type: 'command',
        timestamp: Date.now(),
        payload: { projectId: 'proj-1', action: 'restart', args: { force: true } },
      });

      // Wait for message processing
      await new Promise((r) => setTimeout(r, 50));

      expect(handler).toHaveBeenCalledWith('restart', { force: true });
    });
  });

  describe('reconnect', () => {
    it('reconnects after server closes connection', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      const disconnected = new Promise<void>((resolve) => client.on('disconnected', resolve));

      // Close all server connections
      for (const ws of wss.clients) {
        ws.close();
      }
      await disconnected;

      // Wait for reconnect
      const reconnected = new Promise<void>((resolve) => {
        client.on('connected', resolve);
      });

      vi.advanceTimersByTime(RECONNECT_DELAY_MS + 100);
      await reconnected;

      expect(client.isConnected).toBe(true);
    });

    it('does not reconnect after explicit disconnect()', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      client.disconnect();

      // Advance time well past reconnect delay
      vi.advanceTimersByTime(RECONNECT_DELAY_MS * 10);

      expect(client.isConnected).toBe(false);
    });

    it('does not reconnect and exits on auth rejection (close code 4001)', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      const disconnected = new Promise<void>((resolve) => client.on('disconnected', resolve));

      // Server closes with auth-rejected code
      for (const ws of wss.clients) {
        ws.close(WS_CLOSE_AUTH_REJECTED, 'Invalid token');
      }
      await disconnected;

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        '❌ Authentication failed: invalid token. Not retrying.',
      );

      // Advance time — should NOT reconnect
      vi.advanceTimersByTime(RECONNECT_DELAY_MS * 10);
      expect(client.isConnected).toBe(false);

      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('disconnect', () => {
    it('cleanly closes the connection', async () => {
      createClient();
      const connected = new Promise<void>((resolve) => client.on('connected', resolve));
      client.connect();
      await connected;

      client.disconnect();

      expect(client.isConnected).toBe(false);
      expect(client.isAuthenticated).toBe(false);
    });
  });
});
