#!/usr/bin/env node

import { existsSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

import { loadConfig } from "./config.js";
import healthRoutes from "./routes/health.js";
import projectRoutes from "./routes/projects.js";
import githubAuth from "./github/plugin.js";
import { GitHubAuthError } from "./github/auth.js";
import statePlugin from "./state/plugin.js";
import websocket from "./ws/plugin.js";

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

// --- Routes ---

await server.register(githubAuth);
await server.register(statePlugin);
await server.register(healthRoutes);
await server.register(projectRoutes);

// --- Lifecycle ---

async function start() {
  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(
      `🚀 launchpad-hq running on http://${config.host}:${config.port} (${config.isDev ? "dev" : "production"})`,
    );
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
