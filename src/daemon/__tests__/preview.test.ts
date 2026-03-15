import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { PreviewProxyHandler } from '../preview.js';
import type { DaemonWebSocketClient } from '../client.js';
import type {
  PreviewProxyRequestMessage,
  PreviewWsOpenMessage,
  PreviewWsDataMessage,
  PreviewWsCloseMessage,
} from '../../shared/protocol.js';

function createMockClient(): DaemonWebSocketClient {
  return {
    send: vi.fn(),
    isAuthenticated: true,
    isConnected: true,
  } as unknown as DaemonWebSocketClient;
}

function makeProxyRequest(overrides?: Partial<PreviewProxyRequestMessage['payload']>): PreviewProxyRequestMessage {
  return {
    type: 'preview-proxy-request',
    timestamp: Date.now(),
    payload: {
      requestId: 'req-1',
      method: 'GET',
      path: '/index.html',
      headers: {},
      ...overrides,
    },
  };
}

describe('PreviewProxyHandler', () => {
  let handler: PreviewProxyHandler;
  let mockClient: DaemonWebSocketClient;

  beforeEach(() => {
    mockClient = createMockClient();
    handler = new PreviewProxyHandler({
      client: mockClient,
      projectId: 'test-project',
      previewPort: 5173,
      autoDetected: false,
      detectedFrom: 'config',
    });
  });

  afterEach(() => {
    handler.cleanup();
  });

  describe('sendConfig', () => {
    it('sends preview-config message to HQ', () => {
      handler.sendConfig();

      expect(mockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview-config',
          payload: {
            projectId: 'test-project',
            port: 5173,
            autoDetected: false,
            detectedFrom: 'config',
          },
        }),
      );
    });
  });

  describe('handleMessage', () => {
    it('returns true for preview-proxy-request', () => {
      const msg = makeProxyRequest();
      expect(handler.handleMessage(msg)).toBe(true);
    });

    it('returns true for preview-ws-open', () => {
      const msg: PreviewWsOpenMessage = {
        type: 'preview-ws-open',
        timestamp: Date.now(),
        payload: { channelId: 'ch-1', path: '/', headers: {} },
      };
      expect(handler.handleMessage(msg)).toBe(true);
    });

    it('returns true for preview-ws-data', () => {
      const msg: PreviewWsDataMessage = {
        type: 'preview-ws-data',
        timestamp: Date.now(),
        payload: { channelId: 'ch-1', data: Buffer.from('hello').toString('base64') },
      };
      expect(handler.handleMessage(msg)).toBe(true);
    });

    it('returns true for preview-ws-close', () => {
      const msg: PreviewWsCloseMessage = {
        type: 'preview-ws-close',
        timestamp: Date.now(),
        payload: { channelId: 'ch-1' },
      };
      expect(handler.handleMessage(msg)).toBe(true);
    });

    it('returns false for unrelated messages', () => {
      expect(handler.handleMessage({ type: 'heartbeat' })).toBe(false);
      expect(handler.handleMessage({ type: 'register' })).toBe(false);
    });
  });

  describe('HTTP proxy', () => {
    it('sends 404 when dev server is unreachable', async () => {
      // Use a port that's almost certainly not listening
      const unreachableHandler = new PreviewProxyHandler({
        client: mockClient,
        projectId: 'test-project',
        previewPort: 19999,
        autoDetected: false,
      });

      const msg = makeProxyRequest({ requestId: 'unreachable-1' });
      unreachableHandler.handleMessage(msg);

      // Wait for the connection error
      await new Promise((resolve) => setTimeout(resolve, 500));

      const sendFn = vi.mocked(mockClient.send);
      const response = sendFn.mock.calls.find(
        (call) => (call[0] as { type: string }).type === 'preview-proxy-response',
      );

      expect(response).toBeDefined();
      const payload = (response![0] as { payload: { requestId: string; statusCode: number } }).payload;
      expect(payload.requestId).toBe('unreachable-1');
      expect(payload.statusCode).toBe(404);

      unreachableHandler.cleanup();
    });

    it('proxies request to a live HTTP server', async () => {
      // Start a simple test server
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<h1>Preview</h1>');
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;

      const liveHandler = new PreviewProxyHandler({
        client: mockClient,
        projectId: 'test-project',
        previewPort: port,
        autoDetected: true,
        detectedFrom: 'port-scan',
      });

      const msg = makeProxyRequest({ requestId: 'live-1', path: '/' });
      liveHandler.handleMessage(msg);

      // Wait for the HTTP response
      await new Promise((resolve) => setTimeout(resolve, 500));

      const sendFn = vi.mocked(mockClient.send);
      const response = sendFn.mock.calls.find(
        (call) => (call[0] as { type: string }).type === 'preview-proxy-response',
      );

      expect(response).toBeDefined();
      const payload = (response![0] as {
        payload: { requestId: string; statusCode: number; body: string };
      }).payload;
      expect(payload.requestId).toBe('live-1');
      expect(payload.statusCode).toBe(200);
      expect(Buffer.from(payload.body, 'base64').toString()).toBe('<h1>Preview</h1>');

      liveHandler.cleanup();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('forwards POST body correctly', async () => {
      let receivedBody = '';
      const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          receivedBody = Buffer.concat(chunks).toString();
          res.writeHead(200);
          res.end('OK');
        });
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;

      const liveHandler = new PreviewProxyHandler({
        client: mockClient,
        projectId: 'test-project',
        previewPort: port,
        autoDetected: false,
      });

      const body = Buffer.from('{"key":"value"}').toString('base64');
      const msg = makeProxyRequest({
        requestId: 'post-1',
        method: 'POST',
        path: '/api/data',
        headers: { 'content-type': 'application/json' },
        body,
      });
      liveHandler.handleMessage(msg);

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedBody).toBe('{"key":"value"}');

      liveHandler.cleanup();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
  });

  describe('cleanup', () => {
    it('can be called multiple times without error', () => {
      handler.cleanup();
      handler.cleanup();
    });
  });
});
