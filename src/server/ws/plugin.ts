import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { WebSocketServer } from "ws";
import { ConnectionManager } from "./connections.js";
import { handleMessage } from "./handler.js";
import type { Channel } from "./types.js";

declare module "fastify" {
  interface FastifyInstance {
    ws: {
      /** Broadcast a payload to all clients subscribed to a channel. */
      broadcast: (channel: Channel, payload: unknown) => void;
      /** Number of connected clients. */
      clients: () => number;
    };
  }
}

const HEARTBEAT_INTERVAL_MS = 30_000;

async function websocketPlugin(fastify: FastifyInstance) {
  const manager = new ConnectionManager();
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade requests on the /ws path
  fastify.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname !== "/ws") {
      // Not ours — let other upgrade handlers (if any) take it
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // New connection
  wss.on("connection", (ws) => {
    const clientId = manager.add(ws);
    fastify.log.info({ clientId }, "WebSocket client connected");

    ws.on("message", (data) => {
      handleMessage(clientId, data.toString(), manager, fastify.log);
    });

    ws.on("close", () => {
      manager.remove(clientId);
      fastify.log.info({ clientId }, "WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      fastify.log.error({ clientId, err }, "WebSocket error");
      manager.remove(clientId);
    });

    // Respond to pong frames (heartbeat ack)
    ws.on("pong", () => {
      const client = manager.get(clientId);
      if (client) client.alive = true;
    });
  });

  // Heartbeat: detect dead connections
  const heartbeat = setInterval(() => {
    for (const client of manager.all()) {
      if (!client.alive) {
        fastify.log.info({ clientId: client.id }, "Heartbeat timeout — terminating");
        client.socket.terminate();
        manager.remove(client.id);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Decorate Fastify for other plugins/routes to push updates
  fastify.decorate("ws", {
    broadcast: (channel: Channel, payload: unknown) => manager.broadcast(channel, payload),
    clients: () => manager.size,
  });

  // Clean up on server close
  fastify.addHook("onClose", () => {
    clearInterval(heartbeat);
    for (const client of manager.all()) {
      client.socket.terminate();
    }
    wss.close();
  });
}

export default fp(websocketPlugin, {
  name: "websocket",
});
