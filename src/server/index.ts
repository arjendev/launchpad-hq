#!/usr/bin/env node

import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";

import { loadConfig } from "./config.js";
import healthRoutes from "./routes/health.js";
import projectRoutes from "./routes/projects.js";
import githubDataRoutes from "./routes/github-data.js";
import githubAuth from "./github/plugin.js";
import githubGraphQLPlugin from "./github/graphql-plugin.js";
import { TunnelError, tunnelErrorGuidance } from "./tunnel.js";
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
import onboardingRoutes from "./routes/onboarding.js";
import selfDaemonPlugin from "./self-daemon/plugin.js";
import selfDaemonRoutes from "./routes/self-daemon.js";
import tunnelPlugin from "./routes/tunnel.js";
import previewRoutes from "./routes/preview.js";
import workflowRoutes from "./routes/workflow.js";
import authPlugin from "./auth/plugin.js";

const config = loadConfig();

// Log level: --verbose → debug, default → warn
const logLevel = process.argv.includes("--verbose") ? "debug" : "warn";

const server = Fastify({
  logger: {
    level: logLevel,
  },
});

// --- Plugins ---

// CORS: restrict origins to localhost + active tunnel URL in all modes
await server.register(cors, {
  origin: (origin, cb) => {
    // No origin = non-browser request (curl, server-to-server) — allow
    if (!origin) return cb(null, true);
    try {
      const parsed = new URL(origin);
      const host = parsed.hostname;
      // Allow localhost / loopback on any port
      if (host === "localhost" || host === "127.0.0.1") {
        return cb(null, true);
      }
      // Allow active tunnel URL origin
      if (server.tunnelManager) {
        const shareUrl = server.tunnelManager.getShareUrl?.();
        if (shareUrl) {
          try {
            const tunnelHost = new URL(shareUrl).hostname;
            if (host === tunnelHost) return cb(null, true);
          } catch { /* bad tunnel URL */ }
        }
      }
    } catch { /* malformed origin */ }
    cb(new Error("CORS: origin not allowed"), false);
  },
  credentials: true,
});

// L1 — Security headers via @fastify/helmet
await server.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],    // Vite injects inline scripts
      styleSrc: ["'self'", "'unsafe-inline'"],      // Mantine uses inline styles
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],                   // equivalent to X-Frame-Options: DENY
    },
  },
  crossOriginEmbedderPolicy: false,                 // allow loading cross-origin resources
});

// Static file serving: serve built client assets in production
if (!config.isDev && existsSync(config.clientDistPath)) {
  await server.register(fastifyStatic, {
    root: config.clientDistPath,
    prefix: "/",
    wildcard: false,
  });

  // SPA fallback: serve index.html for non-API, non-preview routes
  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/preview/") || request.url.startsWith("/api/")) {
      return reply.status(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });
}

// --- WebSocket ---

await server.register(websocket, { isDev: config.isDev });

// --- Auth (depends on websocket for sessionToken) ---

await server.register(authPlugin, { isDev: config.isDev });

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
await server.register(onboardingRoutes);

// --- Workflow (state machine + GitHub sync + REST API) ---

await server.register(workflowRoutes);

// --- Self-daemon (spawns HQ's own daemon as a child process) ---

await server.register(selfDaemonPlugin);
await server.register(selfDaemonRoutes);

// --- Tunnel (Dev Tunnels integration for remote access) ---

await server.register(tunnelPlugin);

// --- Preview proxy (proxies app previews through daemon WS) ---

await server.register(previewRoutes);

// --- Browser opener (cross-platform, best-effort) ---

function tryOpenBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start \"\"" :
    "xdg-open";
  exec(`${cmd} ${JSON.stringify(url)}`, () => {
    // Silent failure — the URL is printed to the console as fallback
  });
}

// --- Lifecycle ---

async function start() {
  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(
      `🚀 launchpad-hq running on http://${config.host}:${config.port}?token=${server.sessionToken} (${config.isDev ? "dev" : "production"})`,
    );

    // If user chose browser-based onboarding, open it now that the server is ready
    if (process.env.LAUNCHPAD_OPEN_ONBOARDING === "true") {
      const onboardingUrl = `http://localhost:${config.port}/onboarding?token=${server.sessionToken}`;
      console.log(`\n🌐 Complete setup in your browser: ${onboardingUrl}`);
      console.log("   (Waiting for you to finish onboarding in the browser…)\n");
      tryOpenBrowser(onboardingUrl);
    }

    // Auto-start tunnel if --tunnel flag was passed (non-blocking)
    if (config.tunnel) {
      server.tunnelManager.start(config.tunnelPort).then(
        (info) => {
          console.log(`🔗 Dev tunnel active: ${info.url}`);
          const shareUrl = server.tunnelManager.getShareUrl();
          if (shareUrl) {
            console.log(`📱 Share URL: ${shareUrl}`);
          }
        },
        (err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`⚠️  Tunnel failed to start: ${message}`);
          if (err instanceof TunnelError) {
            console.warn(`💡 ${tunnelErrorGuidance(err)}`);
          }
        },
      );
    }
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`\n⚠️  Port ${config.port} is already in use.`);
      console.error(`   Either a previous HQ instance is still running, or another service is using this port.`);
      console.error(`   Fix: kill the process using the port, or start with --port <other>\n`);
      process.exit(1);
    }
    server.log.error(err);
    process.exit(1);
  }
}

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) {
    console.log("\n💀 Force exit.");
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`\n⏏ ${signal} received — shutting down…`);

  // Force exit after 5s if graceful shutdown hangs
  const forceTimer = setTimeout(() => {
    console.error("⚠ Shutdown timed out — forcing exit.");
    process.exit(1);
  }, 5_000);
  forceTimer.unref();

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
