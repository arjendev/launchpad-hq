import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";
import type {
  ConversationEntry,
  CopilotSessionEvent,
  AggregatedSession,
  SessionEventsResponse,
} from "./types.js";
import {
  useSessionMessages,
  useSessionTools,
  useAggregatedSession,
} from "./session-hooks.js";
import { authFetchJson as fetchJson } from "./authFetch.js";
import {
  processSessionEvent,
  processEventBatch,
  createEmptyRefs,
} from "./event-processor.js";
import type {
  RawSessionEvent,
  SteeringMessage,
  EventProcessorRefs,
  EventProcessorCallbacks,
} from "./event-processor.js";

// Re-export types that were originally defined here
export type { RawSessionEvent, SteeringMessage } from "./event-processor.js";
export { formatEventContent } from "./event-processor.js";

/**
 * Merges REST messages + historical events + real-time WebSocket events into a
 * unified ConversationEntry[] for the conversation viewer.
 * Subscribes to the copilot WS channel and appends new events in real-time.
 */

// ── Session Events (reverse-paginated event stream) ───

/**
 * Fetches historical events for a session using reverse cursor pagination.
 * Returns pages of events (newest first); flatten in reverse for chronological order.
 */
export function useSessionEvents(sessionId: string | null) {
  return useInfiniteQuery<SessionEventsResponse>({
    queryKey: ["session-events", sessionId],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "100" });
      if (pageParam) params.set("before", pageParam as string);
      try {
        return await fetchJson<SessionEventsResponse>(
          `/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId!)}/events?${params}`,
        );
      } catch {
        // Endpoint may not exist yet (Romilly building in parallel) — degrade gracefully
        return { events: [], hasMore: false, oldestTimestamp: null };
      }
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.oldestTimestamp ?? undefined) : undefined,
    enabled: !!sessionId,
    staleTime: 30_000,
    retry: false,
  });
}

export function useConversationEntries(sessionId: string | null): {
  entries: ConversationEntry[];
  rawEvents: RawSessionEvent[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  sessionStatus: AggregatedSession["status"] | null;
  queuedMessage: string | null;
  setQueuedMessage: (msg: string | null) => void;
  steeringMessage: SteeringMessage | null;
  clearSteeringMessage: () => void;
  hasMoreHistory: boolean;
  fetchMoreHistory: () => void;
  isFetchingMoreHistory: boolean;
} {
  const qc = useQueryClient();
  const {
    data: messagesData,
    isLoading: messagesLoading,
    isError: messagesError,
    error: messagesErr,
  } = useSessionMessages(sessionId);
  const { data: toolsData } = useSessionTools(sessionId);
  const { data: session } = useAggregatedSession(sessionId);

  // Historical events via REST (reverse-paginated)
  const {
    data: eventsData,
    hasNextPage: hasMoreHistory,
    fetchNextPage: fetchMoreHistory,
    isFetchingNextPage: isFetchingMoreHistory,
    isLoading: eventsLoading,
  } = useSessionEvents(sessionId);

  // Track streaming delta content
  const streamingRef = useRef<{ id: string; content: string } | null>(null);
  const [streamingEntry, setStreamingEntry] = useState<ConversationEntry | null>(null);

  // Track reasoning delta content
  const reasoningRef = useRef<{ id: string; content: string } | null>(null);
  const [reasoningEntry, setReasoningEntry] = useState<ConversationEntry | null>(null);

  // Accumulate real-time events
  const [realtimeEntries, setRealtimeEntries] = useState<ConversationEntry[]>([]);

  // Track all raw SDK events for the debug viewer
  const [rawEvents, setRawEvents] = useState<RawSessionEvent[]>([]);

  // Queued message indicator — set when user sends a prompt, cleared on user.message
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);

  // Steering/system message indicator — set on system.message events
  const [steeringMessage, setSteeringMessage] = useState<SteeringMessage | null>(null);
  const steeringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSteeringMessage = useCallback(() => setSteeringMessage(null), []);

  // Consolidated cross-event refs for the live WebSocket handler
  const liveRefsRef = useRef<EventProcessorRefs>(createEmptyRefs());

  // ── Process historical events into entries ──────────
  const historicalEntries = useMemo(() => {
    if (!eventsData?.pages) return [];
    // Pages are fetched newest-first; reverse to get chronological order
    const allEvents = [...eventsData.pages]
      .reverse()
      .flatMap((p) => p.events ?? []);
    if (allEvents.length === 0) return [];
    const { entries, refs } = processEventBatch(
      allEvents,
      sessionId!,
    );
    // Seed live refs with unresolved state from history so the WS handler
    // can correlate tool completions / subagent events that span the boundary.
    const live = liveRefsRef.current;
    for (const [id, args] of refs.toolStarts) {
      if (!live.toolStarts.has(id)) live.toolStarts.set(id, args);
    }
    for (const [id, name] of refs.subagentNames) {
      if (!live.subagentNames.has(id)) live.subagentNames.set(id, name);
    }
    if (!live.mainAgentName && refs.mainAgentName) {
      live.mainAgentName = refs.mainAgentName;
    }
    if (live.subagentStack.length === 0 && refs.subagentStack.length > 0) {
      live.subagentStack = [...refs.subagentStack];
    }
    if (!live.currentIntent && refs.currentIntent) {
      live.currentIntent = refs.currentIntent;
    }
    return entries;
  }, [eventsData?.pages, sessionId]);

  // ── Live WebSocket handler (uses extracted processor) ─
  const { subscribe } = useWebSocket();

  useEffect(() => {
    if (!sessionId) return;

    // Build callbacks that wire into React state
    const callbacks: EventProcessorCallbacks = {
      updateEntries: setRealtimeEntries,
      setStreamingEntry: (entry) => {
        if (entry) {
          streamingRef.current = { id: entry.id, content: entry.content };
        } else {
          streamingRef.current = null;
        }
        setStreamingEntry(entry);
      },
      setReasoningEntry: (entry) => {
        if (entry) {
          reasoningRef.current = { id: entry.id, content: entry.content };
        } else {
          reasoningRef.current = null;
        }
        setReasoningEntry(entry);
      },
      setQueuedMessage,
      setSteeringMessage,
      scheduleSteeringClear: (ms) => {
        if (steeringTimerRef.current) clearTimeout(steeringTimerRef.current);
        steeringTimerRef.current = setTimeout(
          () => setSteeringMessage(null),
          ms,
        );
      },
      invalidateQueries: (keys) => {
        for (const key of keys) {
          void qc.invalidateQueries({ queryKey: key });
        }
      },
      captureRawEvent: (evt) => {
        setRawEvents((prev) => [...prev, evt]);
      },
    };

    const unsub = subscribe("copilot", (msg) => {
      const wsEvent = msg.payload as {
        type: string;
        sessionId?: string;
        event?: CopilotSessionEvent;
        tool?: string;
        args?: Record<string, unknown>;
        timestamp?: number;
      };

      // Only process events for our session
      if (wsEvent.sessionId !== sessionId) return;

      console.log("[LaunchpadHQ Event]", wsEvent.type, wsEvent);

      if (wsEvent.type === "copilot:session-event" && wsEvent.event) {
        const event = wsEvent.event;
        processSessionEvent(
          {
            type: event.type,
            data: event.data as Record<string, unknown>,
            timestamp: event.timestamp,
            id: (event as Record<string, unknown>).id as string | undefined,
          },
          sessionId,
          liveRefsRef.current,
          callbacks,
          "live",
        );
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
    });

    return unsub;
  }, [sessionId, subscribe, qc]);

  // Reset all state when session changes
  const prevSessionRef = useRef(sessionId);
  useEffect(() => {
    if (sessionId !== prevSessionRef.current) {
      prevSessionRef.current = sessionId;
      setRealtimeEntries([]);
      setRawEvents([]);
      setStreamingEntry(null);
      streamingRef.current = null;
      setReasoningEntry(null);
      reasoningRef.current = null;
      liveRefsRef.current = createEmptyRefs();
      setQueuedMessage(null);
      setSteeringMessage(null);
      if (steeringTimerRef.current) clearTimeout(steeringTimerRef.current);
    }
  }, [sessionId]);

  // Clean up steering auto-dismiss timer on unmount
  useEffect(() => {
    return () => {
      if (steeringTimerRef.current) clearTimeout(steeringTimerRef.current);
    };
  }, []);

  // ── Build unified entries list ──────────────────────
  const entries = useCallback((): ConversationEntry[] => {
    const result: ConversationEntry[] = [];
    const hasHistoricalEvents = historicalEntries.length > 0;

    // Determine the oldest timestamp covered by historical events
    const oldestHistoricalTs = hasHistoricalEvents
      ? Math.min(...historicalEntries.map((e) => e.timestamp))
      : Infinity;

    // 1. Add historical event entries (authoritative for their time range)
    if (hasHistoricalEvents) {
      result.push(...historicalEntries);
    }

    // 2. Add REST messages — only for timestamps BEFORE historical coverage
    //    (when events are available they're authoritative; REST is the fallback)
    if (messagesData?.messages) {
      for (const msg of messagesData.messages) {
        if (hasHistoricalEvents && msg.timestamp >= oldestHistoricalTs) continue;
        const meta = msg.metadata;
        const eventData: Record<string, unknown> | undefined =
          meta && Object.keys(meta).length > 0 ? { ...meta } : undefined;
        result.push({
          id: `msg-${msg.timestamp}-${msg.role}`,
          type: msg.role === "user" ? "user" : msg.role === "assistant" ? "assistant" : "status",
          content: msg.content,
          timestamp: msg.timestamp,
          ...(eventData ? { eventData } : {}),
        });
      }
    }

    // 3. Add tool invocations from REST — only for timestamps before historical coverage
    if (toolsData?.invocations) {
      for (const inv of toolsData.invocations) {
        if (hasHistoricalEvents && inv.timestamp >= oldestHistoricalTs) continue;
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

    // 4. Add realtime entries, deduplicating against historical + REST data
    const seenIds = new Set(result.map((e) => e.id));
    const restTimestamps = new Set(result.map((e) => e.timestamp));
    for (const entry of realtimeEntries) {
      if (seenIds.has(entry.id)) continue;
      if (
        (entry.type === "user" || entry.type === "assistant") &&
        restTimestamps.has(entry.timestamp)
      )
        continue;
      seenIds.add(entry.id);
      result.push(entry);
    }

    // 4b. Filter REST-sourced subagent messages when a container already holds them
    const containerParentIds = new Set(
      realtimeEntries
        .filter((e) => e.toolTag === "agent" && (e.subagentEntries?.length ?? 0) > 0)
        .map((e) => e.toolCallId),
    );
    if (containerParentIds.size > 0) {
      const filtered = result.filter((e) => {
        if (e.type !== "assistant") return true;
        const ptc = (e.eventData as Record<string, unknown> | undefined)
          ?.parentToolCallId as string | undefined;
        return !ptc || !containerParentIds.has(ptc);
      });
      result.length = 0;
      result.push(...filtered);
    }

    // 5. Add streaming entry if present
    if (streamingEntry) {
      result.push(streamingEntry);
    }

    // 6. Add reasoning streaming entry if present
    if (reasoningEntry) {
      result.push(reasoningEntry);
    }

    // Sort by timestamp
    result.sort((a, b) => a.timestamp - b.timestamp);
    return result;
  }, [messagesData, toolsData, historicalEntries, realtimeEntries, streamingEntry, reasoningEntry])();

  return {
    entries,
    rawEvents,
    isLoading: messagesLoading || eventsLoading,
    isError: messagesError,
    error: messagesErr,
    sessionStatus: session?.status ?? null,
    queuedMessage,
    setQueuedMessage,
    steeringMessage,
    clearSteeringMessage,
    hasMoreHistory: hasMoreHistory ?? false,
    fetchMoreHistory: () => void fetchMoreHistory(),
    isFetchingMoreHistory,
  };
}
