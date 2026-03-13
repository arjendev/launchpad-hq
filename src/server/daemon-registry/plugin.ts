import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { WebSocketServer } from "ws";
import { DAEMON_WS_PATH } from "../../shared/constants.js";
import { DaemonRegistry } from "./registry.js";
import { DaemonWsHandler, type TokenLookup } from "./handler.js";

declare module "fastify" {
  interface FastifyInstance {
    daemonRegistry: DaemonRegistry;
  }
}

async function daemonRegistryPlugin(fastify: FastifyInstance) {
  const registry = new DaemonRegistry();
  const wss = new WebSocketServer({ noServer: true });

  // Token lookup: find daemon token from persisted project state.
  // Accessed lazily — stateService is available by the time daemons connect.
  const tokenLookup: TokenLookup = async (projectId: string) => {
    if (!("stateService" in fastify)) return undefined;
    const config = await fastify.stateService.getConfig();
    const [owner, repo] = projectId.split("/");
    const project = config.projects.find(
      (p) =>
        p.owner.toLowerCase() === owner?.toLowerCase() &&
        p.repo.toLowerCase() === repo?.toLowerCase(),
    );
    return project?.daemonToken;
  };

  const handler = new DaemonWsHandler(
    registry,
    tokenLookup,
    (channel, payload) => fastify.ws.broadcast(channel as never, payload),
    fastify.log,
  );

  // Handle HTTP upgrade on the daemon WS path
  fastify.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname !== DAEMON_WS_PATH) {
      // Not ours — let other upgrade handlers handle it (e.g. browser /ws)
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    handler.handleConnection(ws);
  });

  // Broadcast daemon lifecycle events to browser clients on "daemon" channel
  registry.on("daemon:connected", (summary) => {
    fastify.ws.broadcast("daemon" as never, {
      type: "daemon:connected",
      daemon: summary,
    });
  });

  registry.on("daemon:disconnected", (summary) => {
    fastify.ws.broadcast("daemon" as never, {
      type: "daemon:disconnected",
      daemon: summary,
    });
  });

  // Start heartbeat monitoring
  registry.startHeartbeatMonitor();

  // Expose registry as a Fastify decorator
  fastify.decorate("daemonRegistry", registry);

  // Cleanup on close
  fastify.addHook("onClose", () => {
    registry.stopHeartbeatMonitor();
    handler.cleanup();
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
  });
}

export default fp(daemonRegistryPlugin, {
  name: "daemon-registry",
  dependencies: ["websocket"],
});
