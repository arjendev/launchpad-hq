/**
 * Workflow hooks — fetch, sync, and transition workflow issues.
 *
 * Follows the REST + WebSocket merge pattern: initial fetch via TanStack Query,
 * real-time updates via useSubscription on the "workflow" channel.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
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
