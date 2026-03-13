import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { WebSocket } from "ws";
import type {
  DaemonToHqMessage,
  AuthChallengeMessage,
  AuthAcceptMessage,
  AuthRejectMessage,
} from "../../shared/protocol.js";
import { validateDaemonToken } from "../../shared/auth.js";
import type { DaemonRegistry } from "./registry.js";

/** Per-connection state machine for the auth handshake */
interface PendingConnection {
  ws: WebSocket;
  nonce: string;
  createdAt: number;
}

/** Token lookup: given a projectId, return the stored secret (or undefined) */
export type TokenLookup = (projectId: string) => string | undefined;

/** Callback for broadcasting daemon events to browser clients */
export type BrowserBroadcast = (channel: string, payload: unknown) => void;

/**
 * Manages the WebSocket lifecycle for daemon connections.
 *
 * Flow: connection → auth-challenge → auth-response → register → messages
 */
export class DaemonWsHandler {
  private pending = new Map<WebSocket, PendingConnection>();
  private wsToDaemonId = new Map<WebSocket, string>();

  constructor(
    private registry: DaemonRegistry,
    private tokenLookup: TokenLookup,
    private broadcast: BrowserBroadcast,
    private log: FastifyBaseLogger,
  ) {}

  /** Called when a new daemon WebSocket connects */
  handleConnection(ws: WebSocket): void {
    const nonce = randomUUID();
    this.pending.set(ws, { ws, nonce, createdAt: Date.now() });

    const challenge: AuthChallengeMessage = {
      type: "auth-challenge",
      timestamp: Date.now(),
      payload: { nonce },
    };
    ws.send(JSON.stringify(challenge));

    ws.on("message", (data) => {
      this.handleRawMessage(ws, data.toString());
    });

    ws.on("close", () => {
      this.handleDisconnect(ws);
    });

    ws.on("error", (err) => {
      this.log.error({ err }, "Daemon WebSocket error");
      this.handleDisconnect(ws);
    });
  }

  /** Parse and route a raw message from a daemon socket */
  private handleRawMessage(ws: WebSocket, raw: string): void {
    let msg: DaemonToHqMessage;
    try {
      msg = JSON.parse(raw) as DaemonToHqMessage;
    } catch {
      this.log.warn("Invalid JSON from daemon connection");
      return;
    }

    if (!msg || typeof msg.type !== "string") {
      this.log.warn("Missing type field from daemon");
      return;
    }

    // If still in auth handshake, only accept auth-response
    const pending = this.pending.get(ws);
    if (pending) {
      if (msg.type === "auth-response") {
        this.handleAuthResponse(ws, pending, msg);
      } else {
        this.log.warn({ type: msg.type }, "Message before auth — ignoring");
      }
      return;
    }

    // Authenticated — route by type
    this.routeMessage(ws, msg);
  }

  /** Validate auth response and promote or reject */
  private handleAuthResponse(
    ws: WebSocket,
    pending: PendingConnection,
    msg: DaemonToHqMessage & { type: "auth-response" },
  ): void {
    const { projectId, token, nonce } = msg.payload;

    // Verify nonce matches what we sent
    if (nonce !== pending.nonce) {
      this.sendReject(ws, "Nonce mismatch");
      return;
    }

    // Look up expected token for this project
    const expected = this.tokenLookup(projectId);
    if (!expected || !validateDaemonToken(token, expected)) {
      this.sendReject(ws, "Invalid token");
      return;
    }

    // Auth passed — remove from pending, wait for register message
    this.pending.delete(ws);

    const accept: AuthAcceptMessage = {
      type: "auth-accept",
      timestamp: Date.now(),
      payload: { message: "Authenticated" },
    };
    ws.send(JSON.stringify(accept));
    this.log.info({ projectId }, "Daemon authenticated");
  }

  /** Route an authenticated daemon message */
  private routeMessage(ws: WebSocket, msg: DaemonToHqMessage): void {
    switch (msg.type) {
      case "register": {
        const daemonId = msg.payload.projectId;
        this.wsToDaemonId.set(ws, daemonId);
        this.registry.register(daemonId, ws, msg.payload);
        this.log.info({ daemonId, project: msg.payload.projectName }, "Daemon registered");
        break;
      }

      case "heartbeat":
        this.registry.recordHeartbeat(msg.payload.projectId);
        break;

      case "status-update": {
        const daemon = this.registry.getDaemon(msg.payload.projectId);
        if (daemon) {
          this.broadcast("daemon", {
            type: "daemon:status-update",
            daemonId: msg.payload.projectId,
            state: msg.payload.state,
          });
        }
        break;
      }

      case "terminal-data":
        this.broadcast("terminal", {
          type: "terminal:data",
          projectId: msg.payload.projectId,
          sessionId: msg.payload.sessionId,
          data: msg.payload.data,
        });
        break;

      case "terminal-exit":
        this.broadcast("terminal", {
          type: "terminal:exit",
          projectId: msg.payload.projectId,
          terminalId: msg.payload.terminalId,
          exitCode: msg.payload.exitCode,
        });
        break;

      case "copilot-session-update":
        this.registry.emit("copilot:session-update" as never, msg.payload.projectId, msg.payload);
        this.broadcast("copilot", {
          type: "copilot:session-update",
          projectId: msg.payload.projectId,
          session: msg.payload.session,
        });
        break;

      case "copilot-session-list":
        this.registry.emit("copilot:session-list" as never, msg.payload.projectId, msg.payload);
        break;

      case "copilot-session-event":
        this.registry.emit("copilot:session-event" as never, msg.payload.projectId, msg.payload);
        break;

      case "copilot-sdk-session-list":
        this.registry.emit("copilot:session-list" as never, this.wsToDaemonId.get(ws), msg.payload);
        break;

      case "copilot-sdk-session-event":
        this.registry.emit("copilot:session-event" as never, this.wsToDaemonId.get(ws), msg.payload);
        break;

      case "copilot-sdk-state":
        this.registry.emit("copilot:sdk-state" as never, this.wsToDaemonId.get(ws), msg.payload);
        break;

      case "copilot-conversation":
        this.registry.emit("copilot:conversation" as never, msg.payload.projectId, msg.payload);
        this.broadcast("copilot", {
          type: "copilot:conversation",
          projectId: msg.payload.projectId,
          sessionId: msg.payload.sessionId,
          messages: msg.payload.messages,
        });
        break;

      case "attention-item":
        this.broadcast("attention", {
          type: "attention:daemon-item",
          projectId: msg.payload.projectId,
          item: msg.payload.item,
        });
        break;

      case "auth-response":
        // Should not arrive after auth; ignore
        break;

      default:
        this.log.warn({ type: (msg as { type: string }).type }, "Unknown daemon message type");
    }
  }

  /** Handle daemon socket disconnect */
  private handleDisconnect(ws: WebSocket): void {
    // Remove from pending if still authenticating
    this.pending.delete(ws);
    this.wsToDaemonId.delete(ws);

    // Find and unregister the daemon that owns this socket
    for (const daemon of this.registry.getAllDaemons()) {
      const tracked = this.registry.getDaemon(daemon.daemonId);
      if (tracked?.ws === ws) {
        const summary = this.registry.unregister(daemon.daemonId);
        if (summary) {
          this.broadcast("daemon", {
            type: "daemon:disconnected",
            daemon: summary,
          });
        }
        break;
      }
    }
  }

  /** Send auth-reject and close socket */
  private sendReject(ws: WebSocket, reason: string): void {
    const reject: AuthRejectMessage = {
      type: "auth-reject",
      timestamp: Date.now(),
      payload: { reason },
    };
    ws.send(JSON.stringify(reject));
    ws.close();
    this.pending.delete(ws);
    this.log.warn({ reason }, "Daemon auth rejected");
  }

  /** Clean up all pending connections */
  cleanup(): void {
    for (const { ws } of this.pending.values()) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.pending.clear();
  }
}
