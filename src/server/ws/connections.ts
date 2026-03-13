import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type {
  Channel,
  TrackedClient,
  ServerMessage,
} from "./types.js";

/**
 * Manages WebSocket client connections, channel subscriptions,
 * and server→client broadcasting.
 */
export class ConnectionManager {
  private clients = new Map<string, TrackedClient>();

  /** Register a new WebSocket connection. Returns the client id. */
  add(socket: WebSocket): string {
    const id = randomUUID();
    const client: TrackedClient = { id, socket, channels: new Set(), alive: true };
    this.clients.set(id, client);
    return id;
  }

  /** Remove a client entirely and clean up subscriptions. */
  remove(id: string): void {
    this.clients.delete(id);
  }

  /** Get a tracked client by id. */
  get(id: string): TrackedClient | undefined {
    return this.clients.get(id);
  }

  /** Subscribe a client to a channel. */
  subscribe(id: string, channel: Channel): boolean {
    const client = this.clients.get(id);
    if (!client) return false;
    client.channels.add(channel);
    return true;
  }

  /** Unsubscribe a client from a channel. */
  unsubscribe(id: string, channel: Channel): boolean {
    const client = this.clients.get(id);
    if (!client) return false;
    return client.channels.delete(channel);
  }

  /** Get all channel subscriptions for a client. */
  subscriptions(id: string): ReadonlySet<Channel> {
    return this.clients.get(id)?.channels ?? new Set();
  }

  /** Broadcast a message to every client subscribed to the given channel. */
  broadcast(channel: Channel, payload: unknown): void {
    const message: ServerMessage = { type: "update", channel, payload };
    const data = JSON.stringify(message);

    for (const client of this.clients.values()) {
      if (client.channels.has(channel) && client.socket.readyState === client.socket.OPEN) {
        client.socket.send(data);
      }
    }
  }

  /** Send a message to a specific client. */
  send(id: string, message: ServerMessage): boolean {
    const client = this.clients.get(id);
    if (!client || client.socket.readyState !== client.socket.OPEN) return false;
    client.socket.send(JSON.stringify(message));
    return true;
  }

  /** Number of connected clients. */
  get size(): number {
    return this.clients.size;
  }

  /** Iterate over all tracked clients (for heartbeat, etc.). */
  all(): IterableIterator<TrackedClient> {
    return this.clients.values();
  }
}
