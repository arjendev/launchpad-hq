import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
  getGitHubToken,
  getCachedUser,
  GitHubAuthError,
} from "./auth.js";
import type { AuthStatus, GitHubUser } from "./types.js";

declare module "fastify" {
  interface FastifyInstance {
    githubToken: string | null;
    githubUser: GitHubUser | null;
  }
}

async function githubAuthPlugin(fastify: FastifyInstance) {
  // Auth is mandatory — the preflight already validated `gh` and captured
  // the token into process.env.GH_TOKEN. If getGitHubToken() still fails
  // here (e.g. invalid/expired token), we crash instead of silently
  // degrading to local mode.
  let token: string;
  let user: GitHubUser | null;

  try {
    token = await getGitHubToken();
    user = getCachedUser();
  } catch (err) {
    const msg =
      err instanceof GitHubAuthError
        ? err.message
        : "Unexpected error during GitHub authentication";
    console.error(`❌ ${msg}`);
    console.error("   GitHub authentication is required. Run: gh auth login");
    process.exit(1);
  }

  // Decorate the server instance so other plugins can access these
  fastify.decorate("githubToken", token);
  fastify.decorate("githubUser", user);

  fastify.log.info(`Authenticated as GitHub user: ${user?.login ?? "unknown"}`);

  // Auth status endpoint
  fastify.get("/api/auth/status", async (): Promise<AuthStatus> => {
    return {
      authenticated: token !== null && user !== null,
      user: getCachedUser(),
    };
  });
}

export default fp(githubAuthPlugin, {
  name: "github-auth",
});
