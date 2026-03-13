import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  host: string;
  isDev: boolean;
  clientDistPath: string;
  corsOrigin: string;
}

export function loadConfig(): ServerConfig {
  const isDev = process.env.NODE_ENV !== "production";

  return {
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST || "0.0.0.0",
    isDev,
    // In dev: dist/client relative to repo root; in prod: relative to compiled server location
    clientDistPath: isDev
      ? resolve(process.cwd(), "dist", "client")
      : resolve(__dirname, "..", "client"),
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  };
}
