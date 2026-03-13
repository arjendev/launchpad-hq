// ────────────────────────────────────────────────────────
// Fastify plugin — registers GitHubGraphQL client
// ────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { GitHubGraphQL } from "./graphql.js";

declare module "fastify" {
  interface FastifyInstance {
    githubGraphQL: GitHubGraphQL;
  }
}

async function githubGraphQLPlugin(fastify: FastifyInstance) {
  // Depends on github-auth having already decorated `githubToken`
  if (!fastify.hasDecorator("githubToken")) {
    throw new Error(
      "github-graphql plugin requires github-auth to be registered first",
    );
  }

  const client = new GitHubGraphQL(fastify.githubToken);
  fastify.decorate("githubGraphQL", client);

  fastify.log.info("GitHub GraphQL client initialised");
}

export default fp(githubGraphQLPlugin, {
  name: "github-graphql",
  dependencies: ["github-auth"],
});
