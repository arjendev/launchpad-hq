import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSubscription } from "../contexts/WebSocketContext.js";
import { authFetchJson as fetchJson } from "./authFetch.js";
import type {
  DashboardResponse,
  AddProjectRequest,
  ProjectEntry,
  IssuesResponse,
  GitHubIssue,
  DiscoverUsersResponse,
  DiscoverReposResponse,
  DaemonSummary,
} from "./types.js";

/** Fetch cross-project dashboard (includes issue/PR counts per project). */
export function useDashboard() {
  const qc = useQueryClient();
  const query = useQuery<DashboardResponse>({
    queryKey: ["dashboard"],
    queryFn: () => fetchJson<DashboardResponse>("/api/dashboard"),
    refetchInterval: 60_000,
  });

  // Re-fetch dashboard when daemon status changes so project cards update immediately
  const { data: wsUpdate } = useSubscription<DaemonSummary>("daemon");
  const prevUpdateRef = useRef<DaemonSummary | null>(null);
  useEffect(() => {
    if (wsUpdate && wsUpdate !== prevUpdateRef.current) {
      prevUpdateRef.current = wsUpdate;
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
  }, [wsUpdate, qc]);

  return query;
}

/** Add a project to tracking. */
export function useAddProject() {
  const qc = useQueryClient();
  return useMutation<ProjectEntry, Error, AddProjectRequest>({
    mutationFn: (body) =>
      fetchJson<ProjectEntry>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** Remove a tracked project. */
export function useRemoveProject() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { owner: string; repo: string }>({
    mutationFn: ({ owner, repo }) =>
      fetchJson(`/api/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** Regenerate the daemon token for a project. Returns the updated project with new token. */
export function useRegenerateDaemonToken() {
  const qc = useQueryClient();
  return useMutation<ProjectEntry, Error, { owner: string; repo: string }>({
    mutationFn: ({ owner, repo }) =>
      fetchJson<ProjectEntry>(
        `/api/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/regenerate-token`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** Fetch a single project detail (includes existing daemonToken). */
export function useGetProjectDetail() {
  return useMutation<ProjectEntry, Error, { owner: string; repo: string }>({
    mutationFn: ({ owner, repo }) =>
      fetchJson<ProjectEntry>(
        `/api/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      ),
  });
}

/** Search GitHub users/orgs. Query is debounced on the caller side. */
export function useDiscoverUsers(query: string) {
  return useQuery<DiscoverUsersResponse>({
    queryKey: ["discover-users", query],
    queryFn: () =>
      fetchJson<DiscoverUsersResponse>(
        `/api/discover/users?q=${encodeURIComponent(query)}`,
      ),
    enabled: query.length >= 2,
    staleTime: 30_000,
  });
}

/** List/search repos for a GitHub owner. */
export function useDiscoverRepos(owner: string, search?: string) {
  return useQuery<DiscoverReposResponse>({
    queryKey: ["discover-repos", owner, search ?? ""],
    queryFn: () => {
      const params = new URLSearchParams();
      if (owner) params.set("owner", owner);
      if (search) params.set("q", search);
      return fetchJson<DiscoverReposResponse>(
        `/api/discover/repos?${params.toString()}`,
      );
    },
    enabled: owner.length > 0,
    staleTime: 30_000,
  });
}

/**
 * Fetch issues for a specific project (open + closed for kanban columns).
 * Returns combined issue list; column assignment handled by the component.
 */
export function useIssues(owner: string | undefined, repo: string | undefined) {
  const openQuery = useQuery<IssuesResponse>({
    queryKey: ["issues", owner, repo, "open"],
    queryFn: () =>
      fetchJson<IssuesResponse>(
        `/api/projects/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/issues?state=open&first=100`,
      ),
    enabled: !!owner && !!repo,
    refetchInterval: 30_000,
  });

  const closedQuery = useQuery<IssuesResponse>({
    queryKey: ["issues", owner, repo, "closed"],
    queryFn: () =>
      fetchJson<IssuesResponse>(
        `/api/projects/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/issues?state=closed&first=100`,
      ),
    enabled: !!owner && !!repo,
    refetchInterval: 30_000,
  });

  const allIssues: GitHubIssue[] = [
    ...(openQuery.data?.issues ?? []),
    ...(closedQuery.data?.issues ?? []),
  ];

  return {
    issues: allIssues,
    isLoading: openQuery.isLoading || closedQuery.isLoading,
    isError: openQuery.isError || closedQuery.isError,
    error: openQuery.error ?? closedQuery.error,
  };
}
