import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  DashboardResponse,
  AddProjectRequest,
  ProjectEntry,
  IssuesResponse,
  GitHubIssue,
  ApiError,
} from "./types.js";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Fetch cross-project dashboard (includes issue/PR counts per project). */
export function useDashboard() {
  return useQuery<DashboardResponse>({
    queryKey: ["dashboard"],
    queryFn: () => fetchJson<DashboardResponse>("/api/dashboard"),
    refetchInterval: 60_000,
  });
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
