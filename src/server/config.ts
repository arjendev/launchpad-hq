import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Detect if running inside a devcontainer (VS Code remote containers / Codespaces). */
function isDevContainer(): boolean {
  return (
    process.env.REMOTE_CONTAINERS === "true" ||
    process.env.CODESPACES === "true" ||
    process.env.REMOTE_CONTAINERS_IPC !== undefined ||
    process.env.VSCODE_REMOTE_CONTAINERS_SESSION !== undefined
  );
}

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
  // Detect if running from built dist/ (npx, production) vs source (dev with tsx)
  const isBuilt =
    import.meta.url.includes("/dist/") || import.meta.url.includes("\\dist\\");
  const isDev = !isBuilt && process.env.NODE_ENV !== "production";
  const args = process.argv.slice(2);
  const port = Number(process.env.PORT) || 3000;

  return {
    port,
    // In devcontainers, bind 0.0.0.0 so sibling containers can reach HQ
    // over the Docker bridge network (which is already isolated from the host).
    host: process.env.HOST || (isDevContainer() ? "0.0.0.0" : "127.0.0.1"),
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
