import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  host: string;
  isDev: boolean;
  clientDistPath: string;
  corsOrigin: string;
  tunnel: boolean;
  /** Port the tunnel should expose — Vite (5173) in dev, Fastify in prod. */
  tunnelPort: number;
}

export function loadConfig(): ServerConfig {
  const isDev = process.env.NODE_ENV !== "production";
  const args = process.argv.slice(2);
  const port = Number(process.env.PORT) || 3000;

  return {
    port,
    host: process.env.HOST || "127.0.0.1",
    isDev,
    // In dev: dist/client relative to repo root; in prod: relative to compiled server location
    clientDistPath: isDev
      ? resolve(process.cwd(), "dist", "client")
      : resolve(__dirname, "..", "client"),
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
    tunnel: args.includes("--tunnel"),
    // In dev Vite serves the full app on 5173; in prod Fastify serves everything.
    tunnelPort: isDev
      ? Number(process.env.VITE_PORT) || 5173
      : port,
  };
}
