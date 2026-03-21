import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSubscription } from "../contexts/WebSocketContext.js";
import { authFetchJson as fetchJson } from "./authFetch.js";
import type {
  AggregatedSession,
  CopilotSessionSummary,
  CopilotSession,
  SessionMessagesResponse,
  SessionToolsResponse,
  PromptDeliveryMode,
  CopilotSessionMode,
  ModeResponse,
  PlanResponse,
  ModelsResponse,
  CopilotAgentCatalogResponse,
  CopilotAgentPreferenceResponse,
  CopilotSessionAgentResponse,
} from "./types.js";

// ── Aggregated Copilot Sessions ────────────────────────

/** Fetch aggregated copilot sessions across all daemons, polling every 5 seconds. */
export function useAggregatedSessions(projectId?: string): {
  sessions: AggregatedSession[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const query = useQuery<{ sessions: AggregatedSession[]; count: number }>({
    queryKey: ["aggregated-sessions", projectId],
    queryFn: () => {
      const url = projectId
        ? `/api/copilot/aggregated/sessions?projectId=${encodeURIComponent(projectId)}`
        : "/api/copilot/aggregated/sessions";
      return fetchJson<{ sessions: AggregatedSession[]; count: number }>(url);
    },
    refetchInterval: 5_000,
  });

  return {
    sessions: query.data?.sessions ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

// ── Copilot Sessions ──────────────────────────────────

/** Fetch copilot session summaries via REST, merged with live WebSocket updates. */
export function useCopilotSessions(): {
  sessions: CopilotSessionSummary[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const qc = useQueryClient();
  const query = useQuery<CopilotSessionSummary[]>({
    queryKey: ["copilot-sessions"],
    queryFn: async () => {
      const res = await fetchJson<{
        sessions: CopilotSessionSummary[];
        count: number;
        adapter: string;
      }>("/api/copilot/sessions");
      return res.sessions;
    },
    refetchInterval: 30_000,
  });

  const { data: wsEvent } = useSubscription<{
    type: string;
    session: CopilotSessionSummary;
  }>("copilot");

  const prevEventRef = useRef<typeof wsEvent>(null);
  useEffect(() => {
    if (wsEvent && wsEvent !== prevEventRef.current) {
      prevEventRef.current = wsEvent;
      qc.setQueryData<CopilotSessionSummary[]>(["copilot-sessions"], (old) => {
        const list = old ?? [];
        if (wsEvent.type === "session:removed") {
          return list.filter((s) => s.id !== wsEvent.session.id);
        }
        const exists = list.findIndex((s) => s.id === wsEvent.session.id);
        if (exists >= 0) {
          const updated = [...list];
          updated[exists] = wsEvent.session;
          return updated;
        }
        return [wsEvent.session, ...list];
      });
    }
  }, [wsEvent, qc]);

  return {
    sessions: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/** Fetch full copilot session detail (with conversation history). */
export function useCopilotSession(sessionId: string | null) {
  return useQuery<CopilotSession>({
    queryKey: ["copilot-session", sessionId],
    queryFn: () =>
      fetchJson<CopilotSession>(`/api/copilot/sessions/${encodeURIComponent(sessionId!)}`),
    enabled: !!sessionId,
  });
}

// ── Copilot Aggregated Sessions ───────────────────────

/** Fetch a single aggregated session detail. */
export function useAggregatedSession(sessionId: string | null) {
  return useQuery<AggregatedSession>({
    queryKey: ["aggregated-session", sessionId],
    queryFn: () =>
      fetchJson<AggregatedSession>(
        `/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId!)}`,
      ),
    enabled: !!sessionId,
    refetchInterval: 10_000,
  });
}

/** Fetch message history for an aggregated session. */
export function useSessionMessages(sessionId: string | null) {
  return useQuery<SessionMessagesResponse>({
    queryKey: ["session-messages", sessionId],
    queryFn: () =>
      fetchJson<SessionMessagesResponse>(
        `/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId!)}/messages`,
      ),
    enabled: !!sessionId,
  });
}

/** Fetch tool invocation history for an aggregated session. */
export function useSessionTools(sessionId: string | null) {
  return useQuery<SessionToolsResponse>({
    queryKey: ["session-tools", sessionId],
    queryFn: () =>
      fetchJson<SessionToolsResponse>(
        `/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId!)}/tools`,
      ),
    enabled: !!sessionId,
  });
}

/** Fetch available SDK sessions from a daemon (for resume picker). Not cached — always fresh. */
export function useAvailableSdkSessions(owner?: string, repo?: string) {
  return useQuery<{ sessions: Array<{ sessionId: string; summary?: string; startTime: string; modifiedTime: string }> }>({
    queryKey: ["available-sdk-sessions", owner, repo],
    queryFn: () =>
      fetchJson(`/api/daemons/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/copilot/sessions`),
    enabled: !!owner && !!repo,
    staleTime: 0, // Always re-fetch
  });
}

/** Send a prompt to a Copilot session. */
export function useSendPrompt() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean },
    Error,
    { sessionId: string; prompt: string; mode?: PromptDeliveryMode }
  >({
    mutationFn: ({ sessionId, prompt, mode }) =>
      fetchJson(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, ...(mode ? { mode } : {}) }),
      }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["session-messages", variables.sessionId] });
    },
  });
}

/** Create a new Copilot session on a daemon. */
export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean; sessionId: string; sessionType?: string },
    Error,
    {
      owner: string;
      repo: string;
      model?: string;
      sessionType?: string;
      agentId?: string | null;
    }
  >({
    mutationFn: ({ owner, repo, model, sessionType, agentId }) =>
      fetchJson(
        "/api/daemons/" +
          encodeURIComponent(owner) +
          "/" +
          encodeURIComponent(repo) +
          "/copilot/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(model ? { model } : {}),
            ...(sessionType ? { sessionType } : {}),
            ...(sessionType === "copilot-sdk" && agentId !== undefined ? { agentId } : {}),
          }),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["aggregated-sessions"] });
      void qc.invalidateQueries({ queryKey: ["copilot-sessions"] });
    },
  });
}

/** Abort a Copilot session. */
export function useAbortSession() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (sessionId) =>
      fetchJson(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/abort`, {
        method: "POST",
      }),
    onSuccess: (_data, sessionId) => {
      void qc.invalidateQueries({ queryKey: ["aggregated-session", sessionId] });
      void qc.invalidateQueries({ queryKey: ["aggregated-sessions"] });
      void qc.invalidateQueries({ queryKey: ["copilot-sessions"] });
    },
  });
}

// ── New SDK control hooks ─────────────────────────────

/** Resume an idle/ended Copilot session with optional config. */
export function useResumeSession() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean },
    Error,
    { sessionId: string; config?: Record<string, unknown> }
  >({
    mutationFn: ({ sessionId, config }) =>
      fetchJson(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config ? { config } : {}),
      }),
    onSuccess: (_data, { sessionId }) => {
      void qc.invalidateQueries({ queryKey: ["aggregated-session", sessionId] });
      void qc.invalidateQueries({ queryKey: ["aggregated-sessions"] });
      void qc.invalidateQueries({ queryKey: ["copilot-sessions"] });
    },
  });
}

/** Change the model for a Copilot session. */
export function useSetModel() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, { sessionId: string; model: string }>({
    mutationFn: ({ sessionId, model }) =>
      fetchJson(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/set-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      }),
    onSuccess: (_data, { sessionId }) => {
      void qc.invalidateQueries({ queryKey: ["aggregated-session", sessionId] });
      void qc.invalidateQueries({ queryKey: ["aggregated-sessions"] });
    },
  });
}

/** Get the current mode for a session. */
export function useGetMode(sessionId: string | null) {
  return useQuery<ModeResponse>({
    queryKey: ["session-mode", sessionId],
    queryFn: () =>
      fetchJson<ModeResponse>(
        `/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId!)}/mode`,
      ),
    enabled: !!sessionId,
  });
}

/** Set the mode for a Copilot session. */
export function useSetMode() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, { sessionId: string; mode: CopilotSessionMode }>({
    mutationFn: ({ sessionId, mode }) =>
      fetchJson(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      }),
    onSuccess: (_data, { sessionId }) => {
      void qc.invalidateQueries({ queryKey: ["session-mode", sessionId] });
      void qc.invalidateQueries({ queryKey: ["aggregated-session", sessionId] });
      void qc.invalidateQueries({ queryKey: ["aggregated-sessions"] });
    },
  });
}

/** Get the current agent for a session. */
export function useGetSessionAgent(sessionId: string | null) {
  return useQuery<CopilotSessionAgentResponse>({
    queryKey: ["session-agent", sessionId],
    queryFn: () =>
      fetchJson<CopilotSessionAgentResponse>(
        `/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId!)}/agent`,
      ),
    enabled: !!sessionId,
  });
}

/** Set the current agent for a session. */
export function useSetSessionAgent() {
  const qc = useQueryClient();
  return useMutation<
    CopilotSessionAgentResponse,
    Error,
    { sessionId: string; agentId: string | null }
  >({
    mutationFn: ({ sessionId, agentId }) =>
      fetchJson<CopilotSessionAgentResponse>(
        `/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/agent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId }),
        },
      ),
    onSuccess: (data, { sessionId }) => {
      qc.setQueryData(["session-agent", sessionId], data);
    },
    onSettled: (_data, _error, { sessionId }) => {
      void qc.invalidateQueries({ queryKey: ["session-agent", sessionId] });
    },
  });
}

/** Get the plan for a session. */
export function useGetPlan(sessionId: string | null) {
  return useQuery<PlanResponse>({
    queryKey: ["session-plan", sessionId],
    queryFn: () =>
      fetchJson<PlanResponse>(
        `/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId!)}/plan`,
      ),
    enabled: !!sessionId,
  });
}

/** Update (set) the plan for a session. */
export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, { sessionId: string; content: string }>({
    mutationFn: ({ sessionId, content }) =>
      fetchJson(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }),
    onSuccess: (_data, { sessionId }) => {
      void qc.invalidateQueries({ queryKey: ["session-plan", sessionId] });
    },
  });
}

/** Delete the plan for a session. */
export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (sessionId) =>
      fetchJson(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/plan`, {
        method: "DELETE",
      }),
    onSuccess: (_data, sessionId) => {
      void qc.invalidateQueries({ queryKey: ["session-plan", sessionId] });
    },
  });
}

/** Disconnect a session (without aborting). */
export function useDisconnectSession() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (sessionId) =>
      fetchJson(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/disconnect`, {
        method: "POST",
      }),
    onSuccess: (_data, sessionId) => {
      void qc.invalidateQueries({ queryKey: ["aggregated-session", sessionId] });
      void qc.invalidateQueries({ queryKey: ["aggregated-sessions"] });
      void qc.invalidateQueries({ queryKey: ["copilot-sessions"] });
    },
  });
}

/** End & delete a session permanently. */
export function useEndSession() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (sessionId) =>
      fetchJson(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/delete`, {
        method: "POST",
      }),
    onSuccess: (_data, sessionId) => {
      void qc.invalidateQueries({ queryKey: ["aggregated-session", sessionId] });
      void qc.invalidateQueries({ queryKey: ["aggregated-sessions"] });
      void qc.invalidateQueries({ queryKey: ["copilot-sessions"] });
    },
  });
}

/** List available Copilot models. */
export function useListModels() {
  return useQuery<ModelsResponse>({
    queryKey: ["copilot-models"],
    queryFn: () => fetchJson<ModelsResponse>("/api/copilot/models"),
    refetchInterval: 30_000,
  });
}

/** List available Copilot SDK agents for a specific project daemon. */
export function useCopilotAgentCatalog(owner: string | undefined, repo: string | undefined) {
  return useQuery<CopilotAgentCatalogResponse>({
    queryKey: ["copilot-agent-catalog", owner, repo],
    queryFn: () =>
      fetchJson<CopilotAgentCatalogResponse>(
        `/api/daemons/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/copilot/agents`,
      ),
    enabled: !!owner && !!repo,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** Read the remembered Copilot SDK agent for a project. */
export function useCopilotAgentPreference(owner: string | undefined, repo: string | undefined) {
  return useQuery<CopilotAgentPreferenceResponse>({
    queryKey: ["copilot-agent-preference", owner, repo],
    queryFn: () =>
      fetchJson<CopilotAgentPreferenceResponse>(
        `/api/projects/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/preferences/copilot-agent`,
      ),
    enabled: !!owner && !!repo,
    staleTime: 5 * 60_000,
  });
}

/** Update the remembered Copilot SDK agent for a project. */
export function useUpdateCopilotAgentPreference() {
  const qc = useQueryClient();

  return useMutation<
    CopilotAgentPreferenceResponse,
    Error,
    {
      owner: string;
      repo: string;
      agentId: string | null;
      agentName?: string | null;
    },
    {
      previousPreference?: CopilotAgentPreferenceResponse;
      queryKey: readonly [string, string, string];
    }
  >({
    mutationFn: ({ owner, repo, agentId }) =>
      fetchJson<CopilotAgentPreferenceResponse>(
        `/api/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/preferences/copilot-agent`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId }),
        },
      ),
    onMutate: async ({ owner, repo, agentId, agentName }) => {
      const queryKey = ["copilot-agent-preference", owner, repo] as const;
      await qc.cancelQueries({ queryKey });

      const previousPreference = qc.getQueryData<CopilotAgentPreferenceResponse>(queryKey);

      qc.setQueryData<CopilotAgentPreferenceResponse>(queryKey, {
        agentId,
        agentName: agentId ? (agentName ?? previousPreference?.agentName ?? agentId) : null,
      });

      return { previousPreference, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousPreference) {
        qc.setQueryData(context.queryKey, context.previousPreference);
        return;
      }
      if (context) {
        qc.removeQueries({ queryKey: context.queryKey, exact: true });
      }
    },
    onSuccess: (data, { owner, repo }) => {
      qc.setQueryData(["copilot-agent-preference", owner, repo], data);
    },
    onSettled: (_data, _error, { owner, repo }) => {
      void qc.invalidateQueries({
        queryKey: ["copilot-agent-preference", owner, repo],
      });
    },
  });
}
