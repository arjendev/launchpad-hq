// ────────────────────────────────────────────────────────
// GitHub REST API helpers (centralised from route-level fetch calls)
// ────────────────────────────────────────────────────────

const API_BASE = "https://api.github.com";
const USER_AGENT = "launchpad-hq";
const API_VERSION = "2022-11-28";

import { getTracer, isTracingEnabled } from "../observability/tracing.js";
import { SpanStatusCode } from "@opentelemetry/api";

/**
 * Wrap a fetch call with an OTEL span for GitHub REST API tracing.
 */
async function tracedFetch(spanName: string, url: string, init: RequestInit): Promise<Response> {
  if (!isTracingEnabled()) return fetch(url, init);

  const span = getTracer("github-rest").startSpan(spanName, {
    attributes: {
      "http.method": (init.method ?? "GET").toUpperCase(),
      "http.url": url,
      "github.api": "rest",
    },
  });
  try {
    const res = await fetch(url, init);
    span.setAttribute("http.status_code", res.status);
    span.setStatus({ code: res.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR });
    return res;
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    span.end();
  }
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": API_VERSION,
  };
}

/** Result of a repo-existence check with optional permissions. */
export interface RepoValidation {
  exists: boolean;
  status: number;
  permissions?: { push?: boolean; admin?: boolean };
}

/** Check whether a repo exists (optionally returns permissions). */
export async function checkRepo(
  token: string,
  owner: string,
  repo: string,
): Promise<RepoValidation> {
  const res = await tracedFetch(
    `github:checkRepo ${owner}/${repo}`,
    `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { headers: headers(token) },
  );
  if (!res.ok) return { exists: false, status: res.status };
  const data = (await res.json()) as { permissions?: { push?: boolean; admin?: boolean } };
  return { exists: true, status: res.status, permissions: data.permissions };
}

/** Item shape returned by the GitHub search/repos and user/repos endpoints. */
export interface GitHubRepoItem {
  full_name: string;
  owner: { login: string };
  name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  language: string | null;
  updated_at: string;
}

export interface SearchReposResult {
  repos: GitHubRepoItem[];
  status: number;
}

/** Search repositories via the GitHub search API. */
export async function searchRepos(
  token: string,
  query: string,
  opts: { perPage?: number; page?: number } = {},
): Promise<SearchReposResult> {
  const perPage = opts.perPage ?? 10;
  const page = opts.page ?? 1;
  const q = encodeURIComponent(query);
  const res = await tracedFetch(
    "github:searchRepos",
    `${API_BASE}/search/repositories?q=${q}&sort=updated&order=desc&per_page=${perPage}&page=${page}`,
    { headers: headers(token) },
  );
  if (!res.ok) return { repos: [], status: res.status };
  const data = (await res.json()) as { items: GitHubRepoItem[] };
  return { repos: data.items, status: res.status };
}

/** List the authenticated user's own repositories. */
export async function listUserRepos(
  token: string,
  opts: { perPage?: number; page?: number } = {},
): Promise<SearchReposResult> {
  const perPage = opts.perPage ?? 10;
  const page = opts.page ?? 1;
  const res = await tracedFetch(
    "github:listUserRepos",
    `${API_BASE}/user/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&type=owner`,
    { headers: headers(token) },
  );
  if (!res.ok) return { repos: [], status: res.status };
  const repos = (await res.json()) as GitHubRepoItem[];
  return { repos, status: res.status };
}

/** Item shape returned by the GitHub search/users endpoint. */
export interface GitHubUserItem {
  login: string;
  type: "User" | "Organization";
  avatar_url: string;
}

export interface SearchUsersResult {
  users: GitHubUserItem[];
  status: number;
}

/** Search GitHub users/organizations. */
export async function searchUsers(
  token: string,
  query: string,
): Promise<SearchUsersResult> {
  const q = encodeURIComponent(query);
  const res = await tracedFetch(
    "github:searchUsers",
    `${API_BASE}/search/users?q=${q}&per_page=20`,
    { headers: headers(token) },
  );
  if (!res.ok) return { users: [], status: res.status };
  const data = (await res.json()) as { items: GitHubUserItem[] };
  return { users: data.items, status: res.status };
}
