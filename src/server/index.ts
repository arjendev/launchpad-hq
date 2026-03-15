#!/usr/bin/env node

import { existsSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

import { loadConfig } from "./config.js";
import healthRoutes from "./routes/health.js";
import projectRoutes from "./routes/projects.js";
import githubDataRoutes from "./routes/github-data.js";
import githubAuth from "./github/plugin.js";
import githubGraphQLPlugin from "./github/graphql-plugin.js";
import { GitHubAuthError } from "./github/auth.js";
import statePlugin from "./state/plugin.js";
import cachePlugin from "./cache/plugin.js";
import websocket from "./ws/plugin.js";
import daemonRegistryPlugin from "./daemon-registry/plugin.js";

import attentionPlugin from "./attention/plugin.js";
import copilotPlugin from "./copilot/plugin.js";
import copilotAggregatorPlugin from "./copilot-aggregator/plugin.js";
import daemonRoutes from "./routes/daemons.js";
import terminalRelayPlugin from "./terminal-relay/plugin.js";
import terminalRoutes from "./routes/terminals.js";
import copilotSessionRoutes from "./routes/copilot-sessions.js";
import inboxRoutes from "./routes/inbox.js";
import settingsRoutes from "./routes/settings.js";
import selfDaemonPlugin from "./self-daemon/plugin.js";
import selfDaemonRoutes from "./routes/self-daemon.js";
import tunnelPlugin from "./routes/tunnel.js";

const config = loadConfig();

const server = Fastify({
  logger: {
    level: config.isDev ? "info" : "warn",
  },
});

// --- Plugins ---

// CORS: allow Vite dev server origin in development
if (config.isDev) {
  await server.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });
}

// Static file serving: serve built client assets in production
if (!config.isDev && existsSync(config.clientDistPath)) {
  await server.register(fastifyStatic, {
    root: config.clientDistPath,
    prefix: "/",
    wildcard: false,
  });

  // SPA fallback: serve index.html for non-API routes
  server.setNotFoundHandler((_request, reply) => {
    return reply.sendFile("index.html");
  });
}

// --- WebSocket ---

await server.register(websocket);

// --- Terminal relay (depends on websocket) ---

await server.register(terminalRelayPlugin);

// --- Daemon registry (depends on websocket + terminal-relay) ---

await server.register(daemonRegistryPlugin);

// --- Copilot introspection ---

await server.register(copilotPlugin);

// --- Copilot aggregator (daemon-side session aggregation) ---

await server.register(copilotAggregatorPlugin);

// --- Routes ---

await server.register(githubAuth);
await server.register(githubGraphQLPlugin);
await server.register(statePlugin);
await server.register(cachePlugin);
await server.register(healthRoutes);
await server.register(projectRoutes);
await server.register(githubDataRoutes);
await server.register(attentionPlugin);
await server.register(daemonRoutes);
await server.register(terminalRoutes);
await server.register(copilotSessionRoutes);
await server.register(inboxRoutes);
await server.register(settingsRoutes);

// --- Self-daemon (spawns HQ's own daemon as a child process) ---

await server.register(selfDaemonPlugin);
await server.register(selfDaemonRoutes);

// --- Tunnel (Dev Tunnels integration for remote access) ---

await server.register(tunnelPlugin);

// --- Lifecycle ---

async function start() {
  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(
      `🚀 launchpad-hq running on http://${config.host}:${config.port} (${config.isDev ? "dev" : "production"})`,
    );

    // Auto-start tunnel if --tunnel flag was passed
    if (config.tunnel) {
      try {
        const info = await server.tunnelManager.start(config.port);
        console.log(`🔗 Dev tunnel active: ${info.url}`);
        const shareUrl = server.tunnelManager.getShareUrl();
        if (shareUrl) {
          console.log(`📱 Share URL: ${shareUrl}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`⚠️  Tunnel failed to start: ${message}`);
      }
    }
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      console.error(`\n❌ ${err.message}\n`);
      process.exit(1);
    }
    server.log.error(err);
    process.exit(1);
  }
}

function shutdown(signal: string) {
  console.log(`\n⏏ ${signal} received — shutting down…`);
  server.close().then(
    () => {
      console.log("👋 Server closed cleanly.");
      process.exit(0);
    },
    (err) => {
      console.error("Error during shutdown:", err);
      process.exit(1);
    },
  );
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();
