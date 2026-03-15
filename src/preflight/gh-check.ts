/**
 * Pre-flight check: verify the GitHub CLI (`gh`) is installed and authenticated.
 * Runs before any server or daemon startup so we fail fast with a clear message.
 */

import { execFile } from "node:child_process";

const TIMEOUT_MS = 5_000;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Ensures `gh` is on PATH and the user has a valid auth session.
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

  console.log("✅ GitHub CLI authenticated");
}
