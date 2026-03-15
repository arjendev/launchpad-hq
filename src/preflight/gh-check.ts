/**
 * Pre-flight check: verify the GitHub CLI (`gh`) is installed and authenticated.
 * Runs before any server or daemon startup so we fail fast with a clear message.
 */

import { execFile } from "node:child_process";

const TIMEOUT_MS = 5_000;
const MIN_GH_VERSION = "2.17.0";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/** Parse semver from `gh version 2.x.y (...)` output */
function parseGhVersion(output: string): string | null {
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/** Returns true if a >= b (semver) */
function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return true;
}

/**
 * Ensures `gh` is on PATH, is a supported version, and has a valid auth session.
 * Captures the auth token and sets it as `GH_TOKEN` so downstream
 * code (e.g. the Fastify server) can read it from the environment
 * without shelling out again — which can fail under npx contexts.
 * Exits the process with code 1 and a human-readable message on failure.
 */
export async function ensureGhAuthenticated(): Promise<void> {
  // 1. Check gh is installed
  let versionOutput: string;
  try {
    versionOutput = await run("gh", ["--version"]);
  } catch {
    console.error(
      "❌ GitHub CLI (gh) is required but not found.\n   Install it from: https://cli.github.com/",
    );
    process.exit(1);
    return; // unreachable, helps TS
  }

  // 2. Check minimum version (need `gh auth token` from ≥2.17.0)
  const version = parseGhVersion(versionOutput);
  if (!version || !semverGte(version, MIN_GH_VERSION)) {
    console.error(
      `❌ GitHub CLI version ${version ?? "unknown"} is too old (need ≥${MIN_GH_VERSION}).\n   Please upgrade: https://github.com/cli/cli#installation`,
    );
    process.exit(1);
  }

  // 3. Check auth
  try {
    await run("gh", ["auth", "status"]);
  } catch {
    console.error(
      "❌ GitHub CLI is not authenticated.\n   Run: gh auth login",
    );
    process.exit(1);
  }

  // 4. Capture token
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
    } catch {
      console.error(
        "❌ Failed to retrieve GitHub token.\n   Run: gh auth login",
      );
      process.exit(1);
    }
  }

  console.log("✅ GitHub CLI authenticated");
}
