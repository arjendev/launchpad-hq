import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AuthState, GitHubUser } from "./types.js";

const execFileAsync = promisify(execFile);

export class GitHubAuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "GH_NOT_FOUND"
      | "NOT_AUTHENTICATED"
      | "TOKEN_INVALID",
  ) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

// In-memory cache — lives for the server's lifetime
let cachedAuth: AuthState | null = null;

/**
 * Returns a GitHub token. Checks `GH_TOKEN` / `GITHUB_TOKEN` env vars first
 * (set by the preflight check), then falls back to shelling out to `gh auth token`.
 * Caches the result in memory after the first successful call.
 */
export async function getGitHubToken(): Promise<string> {
  if (cachedAuth) return cachedAuth.token;

  // Prefer env vars — the preflight check sets GH_TOKEN so the server
  // doesn't need to shell out again (which can fail under npx contexts).
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  let token: string;
  if (envToken) {
    token = envToken.trim();
  } else {
    try {
      const { stdout } = await execFileAsync("gh", ["auth", "token"]);
      token = stdout.trim();
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        throw new GitHubAuthError(
          "GitHub CLI (gh) not found. Install from https://cli.github.com/",
          "GH_NOT_FOUND",
        );
      }
      // gh exits non-zero when not authenticated
      throw new GitHubAuthError(
        "Not authenticated. Run: gh auth login",
        "NOT_AUTHENTICATED",
      );
    }
  }

  if (!token) {
    throw new GitHubAuthError(
      "Not authenticated. Run: gh auth login",
      "NOT_AUTHENTICATED",
    );
  }

  const user = await validateToken(token);
  cachedAuth = { token, user };
  return token;
}

/**
 * Returns the cached GitHub user info, or null if not yet authenticated.
 */
export function getCachedUser(): GitHubUser | null {
  return cachedAuth?.user ?? null;
}

/**
 * Returns the full cached auth state, or null if not yet authenticated.
 */
export function getCachedAuth(): AuthState | null {
  return cachedAuth;
}

/**
 * Clears the in-memory auth cache. Useful for re-authentication flows.
 */
export function clearAuthCache(): void {
  cachedAuth = null;
}

/**
 * Validates a token against the GitHub API and returns user info.
 */
async function validateToken(token: string): Promise<GitHubUser> {
  let response: Response;
  try {
    response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "launchpad-hq",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    throw new GitHubAuthError(
      "Failed to reach GitHub API. Check your network connection.",
      "TOKEN_INVALID",
    );
  }

  if (response.status === 401) {
    throw new GitHubAuthError(
      "GitHub token is expired or invalid. Run: gh auth login --refresh",
      "TOKEN_INVALID",
    );
  }

  if (!response.ok) {
    throw new GitHubAuthError(
      `GitHub API returned ${response.status}. Try: gh auth login --refresh`,
      "TOKEN_INVALID",
    );
  }

  const data = (await response.json()) as { login: string; avatar_url: string };
  return {
    login: data.login,
    avatarUrl: data.avatar_url,
  };
}
