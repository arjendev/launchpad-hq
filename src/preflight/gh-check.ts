/**
 * Pre-flight check: verify the GitHub CLI (`gh`) is installed and authenticated.
 * Runs before any server or daemon startup so we fail fast with a clear message.
 */

import { execFile } from "node:child_process";

const TIMEOUT_MS = 5_000;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Ensures `gh` is on PATH and the user has a valid auth session.
 * Captures the auth token and sets it as `GH_TOKEN` so downstream
 * code (e.g. the Fastify server) can read it from the environment
 * without shelling out again — which can fail under npx contexts.
 * Exits the process with code 1 and a human-readable message on failure.
 */
export async function ensureGhAuthenticated(): Promise<void> {
  try {
    await run("gh", ["--version"]);
  } catch {
    console.error(
      "❌ GitHub CLI (gh) is required but not found.\n   Install it from: https://cli.github.com/",
    );
    process.exit(1);
  }

  try {
    await run("gh", ["auth", "status"]);
  } catch {
    console.error(
      "❌ GitHub CLI is not authenticated.\n   Run: gh auth login",
    );
    process.exit(1);
  }

  // Capture the token so the server can consume it from the environment
  // instead of shelling out again later (which can fail in npx contexts).
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    try {
      const token = (await run("gh", ["auth", "token"])).trim();
      if (!token) {
        console.error(
          "❌ GitHub CLI returned an empty token.\n   Run: gh auth login",
        );
        process.exit(1);
      }
      process.env.GH_TOKEN = token;
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      if (msg.includes("unknown command")) {
        console.error(
          '❌ Your GitHub CLI is too old (missing "gh auth token").\n   Please upgrade: https://github.com/cli/cli#installation',
        );
      } else {
        console.error(
          "❌ Failed to retrieve GitHub token.\n   Run: gh auth login",
        );
      }
      process.exit(1);
    }
  }

  console.log("✅ GitHub CLI authenticated");
}
