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
    githubToken: string;
    githubUser: GitHubUser;
  }
}

async function githubAuthPlugin(fastify: FastifyInstance) {
  // Run auth check at startup
  let token: string;
  try {
    token = await getGitHubToken();
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      fastify.log.error(`GitHub Auth: ${err.message}`);
    }
    throw err;
  }

  const user = getCachedUser();
  if (!user) {
    throw new Error("GitHub auth succeeded but user info is missing");
  }

  // Decorate the server instance so other plugins can access these
  fastify.decorate("githubToken", token);
  fastify.decorate("githubUser", user);

  fastify.log.info(`Authenticated as GitHub user: ${user.login}`);

  // Auth status endpoint
  fastify.get("/api/auth/status", async (): Promise<AuthStatus> => {
    return {
      authenticated: true,
      user: getCachedUser(),
    };
  });
}

export default fp(githubAuthPlugin, {
  name: "github-auth",
});
