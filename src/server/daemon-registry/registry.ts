import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import type { DaemonInfo, HqToDaemonMessage } from "../../shared/protocol.js";
import { HEARTBEAT_TIMEOUT_MS } from "../../shared/constants.js";

/** Connection state of a tracked daemon */
export type DaemonConnectionState = "authenticating" | "connected" | "disconnected";

/** Full entry for a tracked daemon */
export interface TrackedDaemon {
  daemonId: string;
  ws: WebSocket | null;
  info: DaemonInfo;
  state: DaemonConnectionState;
  connectedAt: number;
  lastHeartbeat: number;
  disconnectedAt?: number;
}

/** Serialisable daemon summary (no WebSocket ref) */
export interface DaemonSummary {
  daemonId: string;
  projectId: string;
  projectName: string;
  runtimeTarget: string;
  state: DaemonConnectionState;
  connectedAt: number;
  lastHeartbeat: number;
  disconnectedAt?: number;
  version: string;
  capabilities: string[];
}

export interface DaemonRegistryEvents {
  "daemon:connected": (daemon: DaemonSummary) => void;
  "daemon:disconnected": (daemon: DaemonSummary) => void;
  "daemon:status-update": (daemon: DaemonSummary, payload: unknown) => void;
}

/**
 * In-memory registry tracking all connected daemons.
 * Emits events on connect / disconnect for other server components.
 */
export class DaemonRegistry extends EventEmitter {
  private daemons = new Map<string, TrackedDaemon>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** Register a newly authenticated daemon */
  register(daemonId: string, ws: WebSocket, info: DaemonInfo): void {
    const now = Date.now();
    const existing = this.daemons.get(daemonId);

    // If re-connecting, close previous socket silently
    if (existing?.ws && existing.ws !== ws) {
      try {
        existing.ws.close();
      } catch {
        /* already closed */
      }
    }

    const daemon: TrackedDaemon = {
      daemonId,
      ws,
      info,
      state: "connected",
      connectedAt: now,
      lastHeartbeat: now,
    };
    this.daemons.set(daemonId, daemon);
    this.emit("daemon:connected", this.toSummary(daemon));
  }

  /** Remove daemon on disconnect */
  unregister(daemonId: string): DaemonSummary | undefined {
    const daemon = this.daemons.get(daemonId);
    if (!daemon) return undefined;

    daemon.state = "disconnected";
    daemon.disconnectedAt = Date.now();
    daemon.ws = null;

    const summary = this.toSummary(daemon);
    this.daemons.delete(daemonId);
    this.emit("daemon:disconnected", summary);
    return summary;
  }

  /** Get a single daemon's tracking entry */
  getDaemon(daemonId: string): TrackedDaemon | undefined {
    return this.daemons.get(daemonId);
  }

  /** List all daemons as serialisable summaries */
  getAllDaemons(): DaemonSummary[] {
    return Array.from(this.daemons.values()).map((d) => this.toSummary(d));
  }

  /** Send a typed message to a specific daemon */
  sendToDaemon(daemonId: string, message: HqToDaemonMessage): boolean {
    const daemon = this.daemons.get(daemonId);
    if (!daemon?.ws || daemon.ws.readyState !== daemon.ws.OPEN) return false;
    daemon.ws.send(JSON.stringify(message));
    return true;
  }

  /** Broadcast a message to every connected daemon */
  broadcastToDaemons(message: HqToDaemonMessage): void {
    for (const daemon of this.daemons.values()) {
      if (daemon.ws && daemon.ws.readyState === daemon.ws.OPEN) {
        daemon.ws.send(JSON.stringify(message));
      }
    }
  }

  /** Record a heartbeat for a daemon */
  recordHeartbeat(daemonId: string): void {
    const daemon = this.daemons.get(daemonId);
    if (daemon) daemon.lastHeartbeat = Date.now();
  }

  /** Start periodic heartbeat timeout checking */
  startHeartbeatMonitor(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), HEARTBEAT_TIMEOUT_MS);
  }

  /** Stop heartbeat monitoring (for cleanup / tests) */
  stopHeartbeatMonitor(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Check for timed-out daemons */
  checkHeartbeats(): string[] {
    const now = Date.now();
    const timedOut: string[] = [];

    for (const [id, daemon] of this.daemons) {
      if (daemon.state !== "connected") continue;
      if (now - daemon.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        timedOut.push(id);
        try {
          daemon.ws?.close();
        } catch {
          /* ignore */
        }
        this.unregister(id);
      }
    }
    return timedOut;
  }

  get size(): number {
    return this.daemons.size;
  }

  /** Convert a tracked daemon to a JSON-safe summary */
  private toSummary(daemon: TrackedDaemon): DaemonSummary {
    return {
      daemonId: daemon.daemonId,
      projectId: daemon.info.projectId,
      projectName: daemon.info.projectName,
      runtimeTarget: daemon.info.runtimeTarget,
      state: daemon.state,
      connectedAt: daemon.connectedAt,
      lastHeartbeat: daemon.lastHeartbeat,
      disconnectedAt: daemon.disconnectedAt,
      version: daemon.info.version,
      capabilities: daemon.info.capabilities,
    };
  }
}
