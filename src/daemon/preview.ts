/**
 * Preview proxy handler — relays HTTP requests and WebSocket connections
 * from HQ to the project's local dev server.
 *
 * The proxy chain: Phone → DevTunnel → HQ Fastify → (WS) → Daemon → localhost:port
 */

import * as http from 'node:http';
import WebSocket from 'ws';
import type { DaemonWebSocketClient } from './client.js';
import type {
  PreviewProxyRequestMessage,
  PreviewWsOpenMessage,
  PreviewWsDataMessage,
  PreviewWsCloseMessage,
} from '../shared/protocol.js';

/** Default timeout for HTTP proxy requests (ms) */
const PROXY_TIMEOUT_MS = 10_000;

export interface PreviewProxyHandlerOptions {
  client: DaemonWebSocketClient;
  projectId: string;
  previewPort: number;
  autoDetected: boolean;
  detectedFrom?: 'config' | 'devcontainer' | 'port-scan' | 'package-json';
}

export class PreviewProxyHandler {
  private readonly client: DaemonWebSocketClient;
  private readonly projectId: string;
  private readonly previewPort: number;
  private readonly autoDetected: boolean;
  private readonly detectedFrom?: 'config' | 'devcontainer' | 'port-scan' | 'package-json';

  /** Active local WebSocket channels keyed by channelId */
  private readonly wsChannels = new Map<string, WebSocket>();

  constructor(options: PreviewProxyHandlerOptions) {
    this.client = options.client;
    this.projectId = options.projectId;
    this.previewPort = options.previewPort;
    this.autoDetected = options.autoDetected;
    this.detectedFrom = options.detectedFrom;
  }

  /** Send preview-config message to HQ */
  sendConfig(): void {
    console.log(`📡 Preview proxy: sending preview-config to HQ (project=${this.projectId}, port=${this.previewPort}, source=${this.detectedFrom ?? 'config'})`);
    this.client.send({
      type: 'preview-config',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        port: this.previewPort,
        autoDetected: this.autoDetected,
        detectedFrom: this.detectedFrom,
      },
    });
  }

  /** Handle an incoming HQ message — returns true if handled */
  handleMessage(msg: { type: string }): boolean {
    switch (msg.type) {
      case 'preview-proxy-request':
        this.handleProxyRequest(msg as PreviewProxyRequestMessage);
        return true;
      case 'preview-ws-open':
        this.handleWsOpen(msg as PreviewWsOpenMessage);
        return true;
      case 'preview-ws-data':
        this.handleWsData(msg as PreviewWsDataMessage);
        return true;
      case 'preview-ws-close':
        this.handleWsClose(msg as PreviewWsCloseMessage);
        return true;
      default:
        return false;
    }
  }

  /** Clean up all open WebSocket channels */
  cleanup(): void {
    for (const [channelId, ws] of this.wsChannels) {
      try {
        ws.close(1001, 'daemon disconnecting');
      } catch {
        // Already closed
      }
      this.wsChannels.delete(channelId);
    }
  }

  // -----------------------------------------------------------------------
  // HTTP Proxy
  // -----------------------------------------------------------------------

  private handleProxyRequest(msg: PreviewProxyRequestMessage): void {
    const { requestId, method, path, headers, body } = msg.payload;
    const url = `http://127.0.0.1:${this.previewPort}${path}`;
    console.log(`📡 Preview proxy: ${method} ${path} → ${url} (requestId=${requestId})`);

    const parsed = new URL(url);

    // Remove hop-by-hop headers that shouldn't be forwarded
    const forwardHeaders = { ...headers };
    delete forwardHeaders['host'];
    delete forwardHeaders['connection'];
    delete forwardHeaders['transfer-encoding'];

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: forwardHeaders,
      timeout: PROXY_TIMEOUT_MS,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const responseBody = Buffer.concat(chunks);
        const responseHeaders: Record<string, string> = {};

        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) {
            responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
          }
        }

        this.client.send({
          type: 'preview-proxy-response',
          timestamp: Date.now(),
          payload: {
            requestId,
            statusCode: res.statusCode ?? 502,
            headers: responseHeaders,
            body: responseBody.toString('base64'),
          },
        });
      });

      res.on('error', () => {
        this.sendErrorResponse(requestId, 502, 'Upstream read error');
      });
    });

    req.on('timeout', () => {
      req.destroy();
      this.sendErrorResponse(requestId, 504, 'Gateway timeout');
    });

    req.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED') {
        this.sendErrorResponse(requestId, 404, 'Dev server not reachable');
      } else {
        this.sendErrorResponse(requestId, 502, `Proxy error: ${err.message}`);
      }
    });

    if (body) {
      req.write(Buffer.from(body, 'base64'));
    }

    req.end();
  }

  private sendErrorResponse(requestId: string, statusCode: number, message: string): void {
    this.client.send({
      type: 'preview-proxy-response',
      timestamp: Date.now(),
      payload: {
        requestId,
        statusCode,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from(message).toString('base64'),
      },
    });
  }

  // -----------------------------------------------------------------------
  // WebSocket Relay (HMR support)
  // -----------------------------------------------------------------------

  private handleWsOpen(msg: PreviewWsOpenMessage): void {
    const { channelId, path, headers } = msg.payload;
    console.log(`📡 Preview proxy: WS open channelId=${channelId} path=${path}`);

    // Close existing channel if any
    const existing = this.wsChannels.get(channelId);
    if (existing) {
      try { existing.close(1000); } catch { /* noop */ }
      this.wsChannels.delete(channelId);
    }

    const url = `ws://127.0.0.1:${this.previewPort}${path}`;
    const forwardHeaders = { ...headers };
    delete forwardHeaders['host'];
    delete forwardHeaders['connection'];
    delete forwardHeaders['upgrade'];
    delete forwardHeaders['sec-websocket-key'];
    delete forwardHeaders['sec-websocket-version'];

    let ws: WebSocket;
    try {
      ws = new WebSocket(url, { headers: forwardHeaders });
    } catch {
      this.sendWsClose(channelId, 1011, 'Failed to connect to local dev server');
      return;
    }

    this.wsChannels.set(channelId, ws);

    ws.on('message', (data: Buffer | string) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      this.client.send({
        type: 'preview-ws-data',
        timestamp: Date.now(),
        payload: {
          channelId,
          data: buf.toString('base64'),
        },
      });
    });

    ws.on('close', (code, reason) => {
      this.wsChannels.delete(channelId);
      this.sendWsClose(channelId, code, reason.toString());
    });

    ws.on('error', () => {
      this.wsChannels.delete(channelId);
      this.sendWsClose(channelId, 1011, 'Local WebSocket error');
    });
  }

  private handleWsData(msg: PreviewWsDataMessage): void {
    const { channelId, data } = msg.payload;
    const ws = this.wsChannels.get(channelId);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(Buffer.from(data, 'base64'));
    }
  }

  private handleWsClose(msg: PreviewWsCloseMessage): void {
    const { channelId, code, reason } = msg.payload;
    const ws = this.wsChannels.get(channelId);

    if (ws) {
      this.wsChannels.delete(channelId);
      try {
        ws.close(code ?? 1000, reason ?? '');
      } catch {
        // Already closed
      }
    }
  }

  private sendWsClose(channelId: string, code?: number, reason?: string): void {
    this.client.send({
      type: 'preview-ws-close',
      timestamp: Date.now(),
      payload: { channelId, code, reason },
    });
  }
}
