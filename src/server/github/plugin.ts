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
  // Run auth check at startup — non-fatal so the server can start without GitHub
  let token: string | null = null;
  let user: GitHubUser | null = null;

  try {
    token = await getGitHubToken();
    user = getCachedUser();
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      fastify.log.warn(`GitHub Auth: ${err.message} — GitHub features will be disabled`);
    } else {
      fastify.log.warn({ err }, "Unexpected error during GitHub auth — GitHub features will be disabled");
    }
  }

  // Decorate the server instance so other plugins can access these
  fastify.decorate("githubToken", token);
  fastify.decorate("githubUser", user);

  if (user) {
    fastify.log.info(`Authenticated as GitHub user: ${user.login}`);
  }

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
