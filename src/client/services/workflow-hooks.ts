/**
 * Workflow hooks — fetch, sync, and transition workflow issues.
 *
 * Follows the REST + WebSocket merge pattern: initial fetch via TanStack Query,
 * real-time updates via useSubscription on the "workflow" channel.
 */
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback } from "react";
import { useSubscription } from "../contexts/WebSocketContext.js";
import { authFetchJson as fetchJson, authFetch } from "./authFetch.js";
import { notifications } from "@mantine/notifications";
import type {
  WorkflowIssue,
  WorkflowIssuesResponse,
  WorkflowSyncResponse,
  WorkflowTransitionResponse,
  WorkflowEvent,
  WorkflowState,
  WorkflowElicitation,
  ElicitationListResponse,
  ElicitationRespondResponse,
  ActivityEvent,
  ActivityEventType,
  PaginatedActivityResult,
  CoordinatorStatusResponse,
  DispatchResponse,
} from "./workflow-types.js";

/**
 * Fetch workflow issues for a project (or all projects if owner/repo not provided).
 * Auto-refetches on WebSocket workflow events.
 */
export function useWorkflowIssues(owner?: string, repo?: string) {
  const qc = useQueryClient();
  const enabled = !!owner && !!repo;

  const query = useQuery<WorkflowIssuesResponse>({
    queryKey: ["workflow-issues", owner, repo],
    queryFn: () =>
      fetchJson<WorkflowIssuesResponse>(
        `/api/workflow/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/issues`,
      ),
    enabled,
    refetchInterval: 60_000,
  });

  // Refetch on WebSocket workflow events
  const { data: wsUpdate } = useSubscription<WorkflowEvent>("workflow");
  const prevRef = useRef<WorkflowEvent | null>(null);
  useEffect(() => {
    if (wsUpdate && wsUpdate !== prevRef.current) {
      prevRef.current = wsUpdate;
      // Refetch if the event is for this project (or refetch anyway for safety)
      void qc.invalidateQueries({ queryKey: ["workflow-issues"] });
    }
  }, [wsUpdate, qc]);

  return {
    issues: query.data?.issues ?? [],
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Trigger a GitHub sync for a project's workflow issues.
 */
export function useSyncIssues(owner?: string, repo?: string) {
  const qc = useQueryClient();

  return useMutation<WorkflowSyncResponse, Error>({
    mutationFn: async () => {
      if (!owner || !repo) throw new Error("No project selected");
      const res = await authFetch(
        `/api/workflow/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/sync`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Sync failed (${res.status})`);
      }
      return res.json() as Promise<WorkflowSyncResponse>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workflow-issues", owner, repo] });
    },
  });
}

/**
 * Transition a workflow issue to a new state.
 */
export function useTransitionIssue() {
  const qc = useQueryClient();

  return useMutation<
    WorkflowTransitionResponse,
    Error,
    { owner: string; repo: string; issueNumber: number; newState: WorkflowState }
  >({
    mutationFn: async ({ owner, repo, issueNumber, newState }) => {
      const res = await authFetch(
        `/api/workflow/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/state`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: newState }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Transition failed (${res.status})`);
      }
      return res.json() as Promise<WorkflowTransitionResponse>;
    },
    onSuccess: (_data, { owner, repo }) => {
      void qc.invalidateQueries({ queryKey: ["workflow-issues", owner, repo] });
    },
  });
}

// ── Elicitation hooks ───────────────────────────────────

const ELICITATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes default

/**
 * Fetch pending elicitations and subscribe to WebSocket updates.
 * Shows toast notifications when new elicitations arrive.
 */
export function useElicitations(owner?: string, repo?: string) {
  const qc = useQueryClient();
  const enabled = !!owner && !!repo;

  const query = useQuery<ElicitationListResponse>({
    queryKey: ["elicitations", owner, repo],
    queryFn: () =>
      fetchJson<ElicitationListResponse>(
        `/api/workflow/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/elicitations`,
      ),
    enabled,
    refetchInterval: 30_000,
  });

  // Listen for elicitation WebSocket events
  const { data: wsUpdate } = useSubscription<WorkflowEvent>("workflow");
  const prevRef = useRef<WorkflowEvent | null>(null);
  useEffect(() => {
    if (!wsUpdate || wsUpdate === prevRef.current) return;
    prevRef.current = wsUpdate;

    if (wsUpdate.type === "workflow:elicitation") {
      const e = wsUpdate.elicitation;
      notifications.show({
        id: `elicitation-${e.id}`,
        title: `🟡 Issue #${e.issueNumber} needs your input`,
        message: e.question.length > 100 ? e.question.slice(0, 100) + "…" : e.question,
        color: "yellow",
        autoClose: 10_000,
      });
      void qc.invalidateQueries({ queryKey: ["elicitations"] });
    }

    if (wsUpdate.type === "workflow:elicitation-answered") {
      void qc.invalidateQueries({ queryKey: ["elicitations"] });
    }

    if (wsUpdate.type === "workflow:elicitation-timeout") {
      notifications.show({
        title: `⏰ Issue #${wsUpdate.issueNumber} timed out`,
        message: "The elicitation expired before a response was provided.",
        color: "red",
        autoClose: 8_000,
      });
      void qc.invalidateQueries({ queryKey: ["elicitations"] });
    }
  }, [wsUpdate, qc]);

  const elicitations = query.data?.elicitations ?? [];

  return {
    elicitations,
    pendingCount: elicitations.filter((e) => e.status === "pending").length,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    timeoutMs: ELICITATION_TIMEOUT_MS,
  };
}

/**
 * POST a response to an elicitation.
 */
export function useRespondToElicitation() {
  const qc = useQueryClient();

  return useMutation<
    ElicitationRespondResponse,
    Error,
    { owner: string; repo: string; elicitationId: string; response: string }
  >({
    mutationFn: async ({ owner, repo, elicitationId, response: answer }) => {
      const res = await authFetch(
        `/api/workflow/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/elicitations/${encodeURIComponent(elicitationId)}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: answer }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Response failed (${res.status})`);
      }
      return res.json() as Promise<ElicitationRespondResponse>;
    },
    onSuccess: (_data, { owner, repo }) => {
      void qc.invalidateQueries({ queryKey: ["elicitations", owner, repo] });
      void qc.invalidateQueries({ queryKey: ["workflow-issues", owner, repo] });
    },
  });
}

// ── Activity feed hooks ─────────────────────────────────

/**
 * Fetch activity feed for a project (or global if owner/repo not provided).
 * Subscribes to WebSocket for real-time prepending of new events.
 */
export function useActivityFeed(owner?: string, repo?: string) {
  const qc = useQueryClient();
  const isScoped = !!owner && !!repo;
  const endpoint = isScoped
    ? `/api/workflow/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/activity`
    : `/api/workflow/activity`;

  const [realtimeEvents, setRealtimeEvents] = useState<ActivityEvent[]>([]);

  const query = useQuery<PaginatedActivityResult>({
    queryKey: ["activity-feed", owner ?? "global", repo ?? "global"],
    queryFn: () => fetchJson<PaginatedActivityResult>(endpoint),
    refetchInterval: 60_000,
  });

  // Listen for real-time activity events via WebSocket
  const { data: wsUpdate } = useSubscription<WorkflowEvent>("workflow");
  const prevRef = useRef<WorkflowEvent | null>(null);
  useEffect(() => {
    if (!wsUpdate || wsUpdate === prevRef.current) return;
    prevRef.current = wsUpdate;

    if (wsUpdate.type === "workflow:activity") {
      const event = wsUpdate.event;
      const matchesScope =
        !isScoped ||
        (event.projectOwner === owner && event.projectRepo === repo);
      if (matchesScope) {
        setRealtimeEvents((prev) => [event, ...prev]);
      }
    }
  }, [wsUpdate, isScoped, owner, repo]);

  // Reset realtime buffer on refetch
  useEffect(() => {
    if (query.dataUpdatedAt) {
      setRealtimeEvents([]);
    }
  }, [query.dataUpdatedAt]);

  const fetchedEvents = query.data?.events ?? [];
  const allEvents = [...realtimeEvents, ...fetchedEvents];

  // Dedupe by id (realtime events may also appear in fetched data)
  const seen = new Set<string>();
  const events = allEvents.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  const loadMore = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["activity-feed"] });
  }, [qc]);

  return {
    events,
    total: query.data?.total ?? events.length,
    hasMore: query.data?.hasMore ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    loadMore,
  };
}

// ── Coordinator status hook ─────────────────────────────

/**
 * Fetch coordinator health status for a project.
 * Auto-updates via WebSocket events.
 */
export function useCoordinatorStatus(owner?: string, repo?: string) {
  const qc = useQueryClient();
  const enabled = !!owner && !!repo;

  const query = useQuery<CoordinatorStatusResponse>({
    queryKey: ["coordinator-status", owner, repo],
    queryFn: () =>
      fetchJson<CoordinatorStatusResponse>(
        `/api/workflow/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/coordinator/status`,
      ),
    enabled,
    refetchInterval: 30_000,
  });

  // Refetch on WebSocket workflow events (coordinator status changes)
  const { data: wsUpdate } = useSubscription<WorkflowEvent>("workflow");
  const prevRef = useRef<WorkflowEvent | null>(null);
  useEffect(() => {
    if (wsUpdate && wsUpdate !== prevRef.current) {
      prevRef.current = wsUpdate;
      void qc.invalidateQueries({ queryKey: ["coordinator-status"] });
    }
  }, [wsUpdate, qc]);

  return {
    coordinator: query.data?.coordinator ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

// ── Coordinator start/stop hooks ────────────────────────

/**
 * Start the autonomous coordinator for a project.
 */
export function useStartCoordinator() {
  const qc = useQueryClient();

  return useMutation<{ ok: boolean }, Error, { owner: string; repo: string }>({
    mutationFn: async ({ owner, repo }) => {
      const res = await authFetch(
        `/api/workflow/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/coordinator/start`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Start coordinator failed (${res.status})`);
      }
      return res.json() as Promise<{ ok: boolean }>;
    },
    onSuccess: (_data, { owner, repo }) => {
      void qc.invalidateQueries({ queryKey: ["coordinator-status", owner, repo] });
    },
  });
}

/**
 * Stop the autonomous coordinator for a project.
 */
export function useStopCoordinator() {
  const qc = useQueryClient();

  return useMutation<{ ok: boolean }, Error, { owner: string; repo: string }>({
    mutationFn: async ({ owner, repo }) => {
      const res = await authFetch(
        `/api/workflow/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/coordinator/stop`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Stop coordinator failed (${res.status})`);
      }
      return res.json() as Promise<{ ok: boolean }>;
    },
    onSuccess: (_data, { owner, repo }) => {
      void qc.invalidateQueries({ queryKey: ["coordinator-status", owner, repo] });
    },
  });
}

// ── Dispatch issue hook ─────────────────────────────────

/**
 * Dispatch a backlog issue to the coordinator.
 */
export function useDispatchIssue() {
  const qc = useQueryClient();

  return useMutation<
    DispatchResponse,
    Error,
    { owner: string; repo: string; issueNumber: number }
  >({
    mutationFn: async ({ owner, repo, issueNumber }) => {
      const res = await authFetch(
        `/api/workflow/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dispatch/${issueNumber}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Dispatch failed (${res.status})`);
      }
      return res.json() as Promise<DispatchResponse>;
    },
    onSuccess: (_data, { owner, repo }) => {
      void qc.invalidateQueries({ queryKey: ["workflow-issues", owner, repo] });
      void qc.invalidateQueries({ queryKey: ["coordinator-status", owner, repo] });
      void qc.invalidateQueries({ queryKey: ["activity-feed"] });
    },
  });
}

// ── Create / Update / Comments hooks ────────────────────

interface CreateIssueRequest {
  title: string;
  body?: string;
  labels?: string[];
}

interface CreateIssueResponse {
  issue: WorkflowIssue;
}

/**
 * Create a new issue via the workflow API.
 */
export function useCreateIssue() {
  const qc = useQueryClient();

  return useMutation<
    CreateIssueResponse,
    Error,
    { owner: string; repo: string } & CreateIssueRequest
  >({
    mutationFn: async ({ owner, repo, title, body, labels }) => {
      const res = await authFetch(
        `/api/workflow/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body, labels }),
        },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message ?? `Create issue failed (${res.status})`);
      }
      return res.json() as Promise<CreateIssueResponse>;
    },
    onSuccess: (_data, { owner, repo }) => {
      void qc.invalidateQueries({ queryKey: ["workflow-issues", owner, repo] });
    },
  });
}

interface UpdateIssueRequest {
  title?: string;
  body?: string;
}

interface UpdateIssueResponse {
  issue: WorkflowIssue;
}

/**
 * Update an existing issue's title/body.
 */
export function useUpdateIssue() {
  const qc = useQueryClient();

  return useMutation<
    UpdateIssueResponse,
    Error,
    { owner: string; repo: string; issueNumber: number } & UpdateIssueRequest
  >({
    mutationFn: async ({ owner, repo, issueNumber, title, body }) => {
      const res = await authFetch(
        `/api/workflow/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body }),
        },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message ?? `Update issue failed (${res.status})`);
      }
      return res.json() as Promise<UpdateIssueResponse>;
    },
    onSuccess: (_data, { owner, repo }) => {
      void qc.invalidateQueries({ queryKey: ["workflow-issues", owner, repo] });
    },
  });
}

export interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
}

interface IssueCommentsResponse {
  issueBody: string;
  comments: IssueComment[];
}

/**
 * Fetch issue comments (discussion) from GitHub via the workflow API.
 */
export function useIssueComments(owner?: string, repo?: string, issueNumber?: number) {
  const enabled = !!owner && !!repo && !!issueNumber;

  return useQuery<IssueCommentsResponse>({
    queryKey: ["issue-comments", owner, repo, issueNumber],
    queryFn: () =>
      fetchJson<IssueCommentsResponse>(
        `/api/workflow/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/issues/${issueNumber!}/comments`,
      ),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Post a comment on an issue.
 */
export function useAddComment() {
  const qc = useQueryClient();

  return useMutation<
    { ok: boolean },
    Error,
    { owner: string; repo: string; issueNumber: number; body: string }
  >({
    mutationFn: async ({ owner, repo, issueNumber, body }) => {
      const res = await authFetch(
        `/api/workflow/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message ?? `Comment failed (${res.status})`);
      }
      return res.json() as Promise<{ ok: boolean }>;
    },
    onSuccess: (_data, { owner, repo, issueNumber }) => {
      void qc.invalidateQueries({ queryKey: ["issue-comments", owner, repo, issueNumber] });
    },
  });
}

// ── All-project aggregate hook ──────────────────────────

/**
 * Fetch workflow issues from all known projects and merge into a single list.
 * Used when no specific project is selected ("All" view).
 */
export function useAllWorkflowIssues(
  projects: Array<{ owner: string; repo: string }>,
) {
  const qc = useQueryClient();
  const enabled = projects.length > 0;

  const queries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["workflow-issues", p.owner, p.repo] as const,
      queryFn: () =>
        fetchJson<WorkflowIssuesResponse>(
          `/api/workflow/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/issues`,
        ),
      enabled,
      refetchInterval: 60_000,
    })),
  });

  // Refetch all on WebSocket workflow events
  const { data: wsUpdate } = useSubscription<WorkflowEvent>("workflow");
  const prevRef = useRef<WorkflowEvent | null>(null);
  useEffect(() => {
    if (wsUpdate && wsUpdate !== prevRef.current) {
      prevRef.current = wsUpdate;
      void qc.invalidateQueries({ queryKey: ["workflow-issues"] });
    }
  }, [wsUpdate, qc]);

  const allIssues: WorkflowIssue[] = [];
  for (const q of queries) {
    if (q.data?.issues) {
      allIssues.push(...q.data.issues);
    }
  }

  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  const error = queries.find((q) => q.error)?.error ?? null;

  return {
    issues: allIssues,
    count: allIssues.length,
    isLoading,
    isError,
    error,
  };
}
