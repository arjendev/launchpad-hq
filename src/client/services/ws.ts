/**
 * WebSocket connection manager with auto-reconnect and message queuing.
 *
 * Features:
 * - Auto-connect on creation
 * - Exponential backoff reconnection (1s → 2s → 4s → … → 30s max)
 * - Message queuing during disconnects (replayed on reconnect)
 * - Channel subscription tracking (re-subscribed on reconnect)
 * - Typed message handlers per channel
 * - Ping/pong keep-alive
 */
import type {
  Channel,
  ClientMessage,
  ConnectionStatus,
  ServerMessage,
  UpdateMessage,
} from "./ws-types.js";

export type MessageHandler = (message: UpdateMessage) => void;
export type StatusChangeHandler = (status: ConnectionStatus) => void;

interface WebSocketManagerOptions {
  /** WebSocket URL. Defaults to auto-detected ws(s)://host/ws */
  url?: string;
  /** Initial reconnect delay in ms. Default: 1000 */
  reconnectDelay?: number;
  /** Maximum reconnect delay in ms. Default: 30000 */
  maxReconnectDelay?: number;
  /** Ping interval in ms. Default: 25000 (under server's 30s heartbeat) */
  pingInterval?: number;
  /** Max queued messages during disconnect. Default: 100 */
  maxQueueSize?: number;
}

const DEFAULT_RECONNECT_DELAY = 1000;
const DEFAULT_MAX_RECONNECT_DELAY = 30_000;
const DEFAULT_PING_INTERVAL = 25_000;
const DEFAULT_MAX_QUEUE_SIZE = 100;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private _status: ConnectionStatus = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  private readonly baseUrl: string;
  private readonly autoDetectedUrl: boolean;
  private readonly reconnectDelay: number;
  private readonly maxReconnectDelay: number;
  private readonly pingInterval: number;
  private readonly maxQueueSize: number;

  /** Resolved WS URL (includes session token once fetched). */
  private url: string;

  /** Messages queued while disconnected — replayed on reconnect. */
  private messageQueue: ClientMessage[] = [];

  /** Active channel subscriptions — re-subscribed on reconnect. */
  private subscriptions = new Set<Channel>();

  /** Per-channel update listeners. */
  private channelHandlers = new Map<Channel, Set<MessageHandler>>();

  /** Connection status change listeners. */
  private statusHandlers = new Set<StatusChangeHandler>();

  /** Global message listeners (all server messages). */
  private messageListeners = new Set<(msg: ServerMessage) => void>();

  constructor(options: WebSocketManagerOptions = {}) {
    this.baseUrl = options.url ?? getDefaultWsUrl();
    this.autoDetectedUrl = !options.url;
    this.url = this.baseUrl;
    this.reconnectDelay = options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY;
    this.maxReconnectDelay = options.maxReconnectDelay ?? DEFAULT_MAX_RECONNECT_DELAY;
    this.pingInterval = options.pingInterval ?? DEFAULT_PING_INTERVAL;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  }

  // --- Public API ---

  get status(): ConnectionStatus {
    return this._status;
  }

  /** Open the WebSocket connection. Safe to call multiple times. */
  connect(): void {
    if (this.disposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setStatus("connecting");
    // Only fetch session token when using the auto-detected URL (production).
    // When an explicit URL is provided (e.g. tests), connect directly.
    if (this.autoDetectedUrl) {
      this.fetchTokenAndConnect();
    } else {
      this.createSocket();
    }
  }

  /** Permanently close the connection and stop reconnecting. */
  dispose(): void {
    this.disposed = true;
    this.clearReconnectTimer();
    this.clearPing();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      // Only close if the socket has actually opened; closing a CONNECTING
      // socket triggers a harmless but noisy "closed before connection
      // established" console warning (common with React StrictMode).
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CLOSING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.setStatus("disconnected");
    this.channelHandlers.clear();
    this.statusHandlers.clear();
    this.messageListeners.clear();
    this.messageQueue = [];
  }

  /** Subscribe to a channel. Returns unsubscribe function. */
  subscribe(channel: Channel, handler: MessageHandler): () => void {
    this.subscriptions.add(channel);

    if (!this.channelHandlers.has(channel)) {
      this.channelHandlers.set(channel, new Set());
    }
    this.channelHandlers.get(channel)!.add(handler);

    // Tell the server
    this.send({ type: "subscribe", channel });

    return () => {
      const handlers = this.channelHandlers.get(channel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.channelHandlers.delete(channel);
          this.subscriptions.delete(channel);
          this.send({ type: "unsubscribe", channel });
        }
      }
    };
  }

  /** Listen to connection status changes. Returns unsubscribe function. */
  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  /** Listen to all server messages. Returns unsubscribe function. */
  onMessage(handler: (msg: ServerMessage) => void): () => void {
    this.messageListeners.add(handler);
    return () => {
      this.messageListeners.delete(handler);
    };
  }

  /** Send a message to the server (queued if disconnected). */
  send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      if (this.messageQueue.length < this.maxQueueSize) {
        this.messageQueue.push(message);
      }
    }
  }

  /** Current channel subscriptions. */
  getSubscriptions(): ReadonlySet<Channel> {
    return this.subscriptions;
  }

  // --- Internal ---

  /** Fetch the session token from the API and then create the socket. */
  private fetchTokenAndConnect(): void {
    const apiBase = typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host}`
      : "http://localhost:3000";

    let result: Promise<Response>;
    try {
      result = fetch(`${apiBase}/api/settings`);
    } catch {
      // fetch unavailable (e.g. test environment) — connect without token
      this.createSocket();
      return;
    }

    result
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { sessionToken?: string }) => {
        if (this.disposed) return;
        if (data.sessionToken) {
          const sep = this.baseUrl.includes("?") ? "&" : "?";
          this.url = `${this.baseUrl}${sep}token=${encodeURIComponent(data.sessionToken)}`;
        }
        this.createSocket();
      })
      .catch(() => {
        // If token fetch fails, try connecting without it (will be rejected by server)
        if (!this.disposed) this.scheduleReconnect();
      });
  }

  private createSocket(): void {
    // Null out handlers on the old socket to prevent duplicate message dispatch
    // during the brief overlap when old socket is CLOSING and new one is OPEN.
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
    }

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.resubscribe();
      this.flushQueue();
      this.startPing();
    };

    this.ws.onclose = () => {
      this.clearPing();
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose fires after onerror, so reconnect is handled there
    };

    this.ws.onmessage = (event) => {
      this.handleServerMessage(event.data as string);
    };
  }

  private handleServerMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    // Notify global listeners
    for (const listener of this.messageListeners) {
      listener(msg);
    }

    if (msg.type === "update") {
      const handlers = this.channelHandlers.get(msg.channel);
      if (handlers) {
        for (const handler of handlers) {
          handler(msg);
        }
      }
    }
  }

  private resubscribe(): void {
    for (const channel of this.subscriptions) {
      this.send({ type: "subscribe", channel });
    }
  }

  private flushQueue(): void {
    const queued = this.messageQueue;
    this.messageQueue = [];
    for (const msg of queued) {
      this.send(msg);
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;

    this.setStatus("reconnecting");
    this.clearReconnectTimer();

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelay,
    );
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, this.pingInterval);
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }
}

/** Build the default WebSocket URL from the current page location. */
function getDefaultWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3000/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}
