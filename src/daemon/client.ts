/**
 * Daemon WebSocket client — outbound connection to HQ.
 *
 * Handles connect, auth handshake, registration, heartbeat,
 * reconnect with exponential backoff, and typed message dispatch.
 */

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

import type {
  DaemonInfo,
  DaemonToHqMessage,
  HqToDaemonMessage,
  ProjectState,
} from '../shared/protocol.js';
import {
  DAEMON_WS_PATH,
  HEARTBEAT_INTERVAL_MS,
  RECONNECT_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_BACKOFF_MULTIPLIER,
} from '../shared/constants.js';

export type CommandHandler = (action: string, args?: Record<string, unknown>) => void;

export interface DaemonClientEvents {
  connected: [];
  authenticated: [];
  'auth-rejected': [reason: string];
  disconnected: [code: number, reason: string];
  error: [error: Error];
  message: [message: HqToDaemonMessage];
}

export interface DaemonClientOptions {
  hqUrl: string;
  token: string;
  projectId: string;
  /** Override for testing — injects a WebSocket factory */
  createWebSocket?: (url: string) => WebSocket;
}

export class DaemonWebSocketClient extends EventEmitter<DaemonClientEvents> {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_DELAY_MS;
  private authenticated = false;
  private shouldReconnect = true;
  private commandHandler: CommandHandler | null = null;
  private startTime = Date.now();

  private readonly hqUrl: string;
  private readonly token: string;
  private readonly projectId: string;
  private readonly createWs: (url: string) => WebSocket;

  constructor(options: DaemonClientOptions) {
    super();
    this.hqUrl = options.hqUrl;
    this.token = options.token;
    this.projectId = options.projectId;
    this.createWs = options.createWebSocket ?? ((url: string) => new WebSocket(url));
  }

  /** Initiate WebSocket connection to HQ */
  connect(): void {
    if (this.ws) {
      return;
    }

    const url = this.buildUrl();

    try {
      this.ws = this.createWs(url);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.reconnectDelay = RECONNECT_DELAY_MS;
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as HqToDaemonMessage;
        this.handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    });

    this.ws.on('close', (code, reason) => {
      this.cleanup();
      this.emit('disconnected', code, reason.toString());
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  /** Respond to an auth challenge with the shared secret token */
  authenticate(nonce: string): void {
    this.send({
      type: 'auth-response',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        token: this.token,
        nonce,
      },
    });
  }

  /** Send registration message with project metadata */
  sendRegistration(info: DaemonInfo): void {
    this.send({
      type: 'register',
      timestamp: Date.now(),
      payload: info,
    });
  }

  /** Send a heartbeat to HQ */
  sendHeartbeat(): void {
    this.send({
      type: 'heartbeat',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        uptimeMs: Date.now() - this.startTime,
      },
    });
  }

  /** Report a project state change to HQ */
  sendStatusUpdate(state: ProjectState): void {
    this.send({
      type: 'status-update',
      timestamp: Date.now(),
      payload: {
        projectId: this.projectId,
        state,
      },
    });
  }

  /** Register a handler for commands from HQ */
  onCommand(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  /** Send a typed message to HQ */
  send(message: DaemonToHqMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /** True if connected and authenticated */
  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  /** True if the WebSocket is open */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Graceful disconnect — no reconnect */
  disconnect(): void {
    this.shouldReconnect = false;
    this.cleanup();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      // Replace listeners with no-op error handler to absorb teardown errors
      ws.removeAllListeners();
      ws.on('error', () => {});
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'daemon shutting down');
      } else {
        ws.terminate();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private buildUrl(): string {
    const base = this.hqUrl.replace(/\/$/, '');
    return `${base}${DAEMON_WS_PATH}`;
  }

  private handleMessage(msg: HqToDaemonMessage): void {
    this.emit('message', msg);

    switch (msg.type) {
      case 'auth-challenge':
        this.authenticate(msg.payload.nonce);
        break;

      case 'auth-accept':
        this.authenticated = true;
        this.startHeartbeat();
        this.emit('authenticated');
        break;

      case 'auth-reject':
        this.authenticated = false;
        this.emit('auth-rejected', msg.payload.reason);
        break;

      case 'command':
        if (this.commandHandler) {
          this.commandHandler(msg.payload.action, msg.payload.args);
        }
        break;

      case 'request-status':
        // The caller should hook into 'message' event for this
        break;

      case 'terminal-input':
        // Handled via 'message' event by higher-level code
        break;

      case 'terminal-spawn':
        // Handled via 'message' event by terminal handler
        break;

      case 'terminal-resize':
        // Handled via 'message' event by terminal handler
        break;

      case 'terminal-kill':
        // Handled via 'message' event by terminal handler
        break;

      case 'copilot-create-session':
      case 'copilot-resume-session':
      case 'copilot-send-prompt':
      case 'copilot-abort-session':
      case 'copilot-list-sessions':
        // Handled via 'message' event by CopilotManager
        break;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ws = null;
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_BACKOFF_MULTIPLIER,
      RECONNECT_MAX_DELAY_MS,
    );
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.authenticated = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
