import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useSubscription } from "../contexts/WebSocketContext.js";
import type {
  DashboardResponse,
  AddProjectRequest,
  ProjectEntry,
  IssuesResponse,
  GitHubIssue,
  ApiError,
  DaemonSummary,
  AggregatedSession,
  SessionMessagesResponse,
  SessionToolsResponse,
  ConversationEntry,
  CopilotSessionEvent,
  CopilotSessionSummary,
  CopilotSession,
  AttentionItem,
  AttentionCountResponse,
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

// ── Daemons ────────────────────────────────────────────

/** Fetch all connected daemons, polling every 5 seconds. */
export function useDaemons(): {
  daemons: DaemonSummary[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const qc = useQueryClient();
  const query = useQuery<DaemonSummary[]>({
    queryKey: ["daemons"],
    queryFn: () => fetchJson<DaemonSummary[]>("/api/daemons"),
    refetchInterval: 5_000,
  });

  const { data: wsUpdate } = useSubscription<DaemonSummary>("daemon");

  const prevUpdateRef = useRef<DaemonSummary | null>(null);
  useEffect(() => {
    if (wsUpdate && wsUpdate !== prevUpdateRef.current) {
      prevUpdateRef.current = wsUpdate;
      void qc.invalidateQueries({ queryKey: ["daemons"] });
    }
  }, [wsUpdate, qc]);

  return {
    daemons: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/** Find the daemon connected for a specific project. */
export function useDaemonForProject(projectId: string | undefined): {
  daemon: DaemonSummary | null;
  isLoading: boolean;
} {
  const { daemons, isLoading } = useDaemons();
  const daemon = useMemo(
    () => daemons.find((d) => d.projectId === projectId && d.state === "connected") ?? null,
    [daemons, projectId],
  );
  return { daemon, isLoading };
}

// ── Aggregated Copilot Sessions ────────────────────────

/** Fetch aggregated copilot sessions across all daemons, polling every 5 seconds. */
export function useAggregatedSessions(projectId?: string): {
  sessions: AggregatedSession[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const query = useQuery<{ sessions: AggregatedSession[]; count: number }>({
    queryKey: ["aggregated-sessions"],
    queryFn: () =>
      fetchJson<{ sessions: AggregatedSession[]; count: number }>(
        "/api/copilot/aggregated/sessions",
      ),
    refetchInterval: 5_000,
  });

  const sessions = useMemo(() => {
    const all = query.data?.sessions ?? [];
    if (!projectId) return all;
    return all.filter((s) => s.projectId === projectId);
  }, [query.data, projectId]);

  return {
    sessions,
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
      const res = await fetchJson<{ sessions: CopilotSessionSummary[]; count: number; adapter: string }>("/api/copilot/sessions");
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
      fetchJson<CopilotSession>(
        `/api/copilot/sessions/${encodeURIComponent(sessionId!)}`,
      ),
    enabled: !!sessionId,
  });
}

// ── Attention Items ────────────────────────────────────

/** Fetch undismissed attention items. */
export function useAttentionItems() {
  return useQuery<{ items: AttentionItem[] }>({
    queryKey: ["attention"],
    queryFn: () =>
      fetchJson<{ items: AttentionItem[] }>("/api/attention?dismissed=false"),
    refetchInterval: 30_000,
  });
}

/** Fetch attention badge count. */
export function useAttentionCount() {
  return useQuery<AttentionCountResponse>({
    queryKey: ["attention-count"],
    queryFn: () => fetchJson<AttentionCountResponse>("/api/attention/count"),
    refetchInterval: 15_000,
  });
}

/** Dismiss an attention item. */
export function useDismissAttention() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; unreadCount: number }, Error, string>({
    mutationFn: (id) =>
      fetchJson(`/api/attention/${encodeURIComponent(id)}/dismiss`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["attention"] });
      void qc.invalidateQueries({ queryKey: ["attention-count"] });
    },
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

/** Send a prompt to a Copilot session. */
export function useSendPrompt() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, { sessionId: string; prompt: string }>({
    mutationFn: ({ sessionId, prompt }) =>
      fetchJson(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["session-messages", variables.sessionId] });
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
    },
  });
}

/**
 * Merges REST messages + real-time WebSocket events into a unified
 * ConversationEntry[] for the conversation viewer.
 * Subscribes to the copilot WS channel and appends new events in real-time.
 */
export function useConversationEntries(sessionId: string | null): {
  entries: ConversationEntry[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  sessionStatus: AggregatedSession["status"] | null;
} {
  const qc = useQueryClient();
  const { data: messagesData, isLoading: messagesLoading, isError: messagesError, error: messagesErr } =
    useSessionMessages(sessionId);
  const { data: toolsData } = useSessionTools(sessionId);
  const { data: session } = useAggregatedSession(sessionId);

  // Track streaming delta content
  const streamingRef = useRef<{ id: string; content: string } | null>(null);
  const [streamingEntry, setStreamingEntry] = useState<ConversationEntry | null>(null);

  // Accumulate real-time events
  const [realtimeEntries, setRealtimeEntries] = useState<ConversationEntry[]>([]);

  // Subscribe to WebSocket copilot events
  const { data: wsEvent } = useSubscription<{
    type: string;
    sessionId?: string;
    event?: CopilotSessionEvent;
    // tool invocation fields
    tool?: string;
    args?: Record<string, unknown>;
    timestamp?: number;
  }>("copilot");

  const prevWsRef = useRef<typeof wsEvent>(null);
  useEffect(() => {
    if (!wsEvent || wsEvent === prevWsRef.current || !sessionId) return;
    prevWsRef.current = wsEvent;

    // Only process events for our session
    if (wsEvent.sessionId !== sessionId) return;

    if (wsEvent.type === "copilot:session-event" && wsEvent.event) {
      const event = wsEvent.event;
      const ts = event.timestamp;

      switch (event.type) {
        case "user.message":
          setRealtimeEntries((prev) => [
            ...prev,
            {
              id: `rt-user-${ts}`,
              type: "user",
              content: (event.data.content as string) ?? "",
              timestamp: ts,
            },
          ]);
          // Also invalidate messages to sync state
          void qc.invalidateQueries({ queryKey: ["session-messages", sessionId] });
          break;

        case "assistant.message.delta": {
          const delta = (event.data.content as string) ?? "";
          if (!streamingRef.current) {
            streamingRef.current = { id: `rt-stream-${ts}`, content: delta };
          } else {
            streamingRef.current.content += delta;
          }
          setStreamingEntry({
            id: streamingRef.current.id,
            type: "assistant",
            content: streamingRef.current.content,
            timestamp: ts,
            isStreaming: true,
          });
          break;
        }

        case "assistant.message":
          // Final assistant message replaces streaming content
          streamingRef.current = null;
          setStreamingEntry(null);
          setRealtimeEntries((prev) => [
            ...prev,
            {
              id: `rt-asst-${ts}`,
              type: "assistant",
              content: (event.data.content as string) ?? "",
              timestamp: ts,
            },
          ]);
          void qc.invalidateQueries({ queryKey: ["session-messages", sessionId] });
          break;

        case "tool.executionStart":
          setRealtimeEntries((prev) => [
            ...prev,
            {
              id: `rt-tool-${ts}`,
              type: "tool",
              content: (event.data.description as string) ?? "",
              toolName: (event.data.name as string) ?? "tool",
              toolStatus: "running",
              timestamp: ts,
            },
          ]);
          break;

        case "tool.executionComplete":
          setRealtimeEntries((prev) => {
            // Update matching running tool entry
            const toolName = (event.data.name as string) ?? "tool";
            const idx = [...prev].reverse().findIndex(
              (e) => e.type === "tool" && e.toolName === toolName && e.toolStatus === "running",
            );
            if (idx >= 0) {
              const realIdx = prev.length - 1 - idx;
              const updated = [...prev];
              updated[realIdx] = {
                ...updated[realIdx],
                toolStatus: (event.data.error as string) ? "failed" : "completed",
                content: (event.data.result as string) ?? updated[realIdx].content,
              };
              return updated;
            }
            return [
              ...prev,
              {
                id: `rt-toolcomplete-${ts}`,
                type: "tool",
                content: (event.data.result as string) ?? "",
                toolName: (event.data.name as string) ?? "tool",
                toolStatus: (event.data.error as string) ? "failed" : "completed",
                timestamp: ts,
              },
            ];
          });
          break;

        case "session.idle":
          setRealtimeEntries((prev) => [
            ...prev,
            {
              id: `rt-idle-${ts}`,
              type: "status",
              content: "Session idle",
              timestamp: ts,
            },
          ]);
          break;

        case "session.error":
          setRealtimeEntries((prev) => [
            ...prev,
            {
              id: `rt-error-${ts}`,
              type: "error",
              content: (event.data.message as string) ?? "Session error",
              timestamp: ts,
            },
          ]);
          break;

        default:
          break;
      }
    }

    if (wsEvent.type === "copilot:tool-invocation") {
      const ts = wsEvent.timestamp ?? Date.now();
      setRealtimeEntries((prev) => [
        ...prev,
        {
          id: `rt-hqtool-${ts}`,
          type: "hq-tool",
          content: "",
          hqToolName: wsEvent.tool,
          hqToolArgs: wsEvent.args,
          timestamp: ts,
        },
      ]);
    }
  }, [wsEvent, sessionId, qc]);

  // Reset realtime entries when session changes
  const prevSessionRef = useRef(sessionId);
  useEffect(() => {
    if (sessionId !== prevSessionRef.current) {
      prevSessionRef.current = sessionId;
      setRealtimeEntries([]);
      setStreamingEntry(null);
      streamingRef.current = null;
    }
  }, [sessionId]);

  // Build unified entries list from REST messages + tool invocations + realtime events
  const entries = useCallback((): ConversationEntry[] => {
    const result: ConversationEntry[] = [];

    // 1. Add REST messages
    if (messagesData?.messages) {
      for (const msg of messagesData.messages) {
        result.push({
          id: `msg-${msg.timestamp}-${msg.role}`,
          type: msg.role === "user" ? "user" : msg.role === "assistant" ? "assistant" : "status",
          content: msg.content,
          timestamp: msg.timestamp,
        });
      }
    }

    // 2. Add tool invocations from REST
    if (toolsData?.invocations) {
      for (const inv of toolsData.invocations) {
        result.push({
          id: `tool-${inv.timestamp}-${inv.tool}`,
          type: "hq-tool",
          content: "",
          hqToolName: inv.tool,
          hqToolArgs: inv.args,
          timestamp: inv.timestamp,
        });
      }
    }

    // 3. Add realtime entries (deduplicate by checking if a REST message already covers this timestamp)
    const restTimestamps = new Set(result.map((e) => e.timestamp));
    for (const entry of realtimeEntries) {
      if (!restTimestamps.has(entry.timestamp)) {
        result.push(entry);
      }
    }

    // 4. Add streaming entry if present
    if (streamingEntry) {
      result.push(streamingEntry);
    }

    // Sort by timestamp
    result.sort((a, b) => a.timestamp - b.timestamp);
    return result;
  }, [messagesData, toolsData, realtimeEntries, streamingEntry])();

  return {
    entries,
    isLoading: messagesLoading,
    isError: messagesError,
    error: messagesErr,
    sessionStatus: session?.status ?? null,
  };
}
