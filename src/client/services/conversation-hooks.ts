import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";
import type {
  ConversationEntry,
  CopilotSessionEvent,
  AggregatedSession,
} from "./types.js";
import {
  useSessionMessages,
  useSessionTools,
  useAggregatedSession,
} from "./session-hooks.js";

/**
 * Merges REST messages + real-time WebSocket events into a unified
 * ConversationEntry[] for the conversation viewer.
 * Subscribes to the copilot WS channel and appends new events in real-time.
 */

function formatEventContent(eventType: string, data: Record<string, unknown>): string {
  switch (eventType) {
    case "session.start":
      return "Session started";
    case "session.resume":
      return "Session resumed";
    case "session.shutdown":
      return "Session ended";
    case "session.title_changed":
      return `Title: ${data.title ?? ""}`;
    case "session.model_change":
      return `Model changed to ${data.model ?? "unknown"}`;
    case "session.mode_changed":
      return `Mode: ${data.mode ?? "unknown"}`;
    case "session.plan_changed":
      return "Plan updated";
    case "session.task_complete":
      return "Task complete";
    case "session.compaction_start":
      return "Compacting context…";
    case "session.compaction_complete":
      return "Context compacted";
    case "session.truncation":
      return "Context truncated";
    case "session.info":
      return String(data.message ?? data.content ?? "Info");
    case "session.warning":
      return String(data.message ?? data.content ?? "Warning");
    case "session.usage_info":
      return `Tokens: ${JSON.stringify(data)}`;
    case "assistant.turn_start":
      return "Turn started";
    case "assistant.turn_end":
      return "Turn ended";
    case "assistant.reasoning":
      return String(data.content ?? data.reasoning ?? "Reasoning…");
    case "assistant.reasoning_delta":
      return String(data.deltaContent ?? "");
    case "assistant.intent":
      return `Intent: ${data.intent ?? ""}`;
    case "assistant.usage":
      return `Usage: ${JSON.stringify(data)}`;
    case "tool.execution_partial_result":
      return `Partial: ${data.partialOutput ?? ""}`;
    case "tool.execution_progress":
      return `Progress: ${data.progressMessage ?? ""}`;
    case "permission.requested":
      return `Permission needed: ${data.tool ?? data.action ?? ""}`;
    case "permission.completed":
      return `Permission ${data.granted ? "granted" : "denied"}`;
    case "elicitation.requested":
      return `Question: ${data.message ?? ""}`;
    case "elicitation.completed":
      return `Answer: ${data.response ?? ""}`;
    case "subagent.selected":
      return `Selected agent: ${data.agentDisplayName ?? data.agentName ?? "unknown"}`;
    case "subagent.started":
      return `Started agent: ${data.agentDisplayName ?? data.agentName ?? "unknown"}`;
    case "subagent.completed":
      return `Completed agent: ${data.agentDisplayName ?? data.agentName ?? "unknown"}`;
    case "subagent.failed":
      return `Agent failed: ${data.agentDisplayName ?? data.agentName ?? "unknown"} — ${data.error ?? ""}`;
    case "subagent.deselected":
      return "Returned to the default agent";
    case "abort":
      return "Aborted";
    case "system.message": {
      const role = data.role as string | undefined;
      const content = String(data.content ?? "");
      const prefix = role === "developer" ? "Developer" : "System";
      return `${prefix}: ${content.slice(0, 100)}`;
    }
    default: {
      const summary = Object.entries(data)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 80) : JSON.stringify(v)}`)
        .join(", ");
      return summary || eventType;
    }
  }
}

/** Raw SDK event as received over WebSocket */
export interface RawSessionEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  id?: string;
}

export interface SteeringMessage {
  content: string;
  role: "system" | "developer";
  timestamp: number;
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

  // Track latest assistant.usage for annotating the next assistant message
  const lastUsageRef = useRef<{ model: string; duration: number; inputTokens: number; outputTokens: number; initiator: string } | null>(null);

  // Track tool.execution_start args by toolCallId for correlating with completions
  const toolStartsRef = useRef<Map<string, Record<string, unknown>>>(new Map());

  // Track subagent display names by toolCallId
  const subagentNamesRef = useRef<Map<string, string>>(new Map());

  // Track the selected main agent name (from subagent.selected)
  const mainAgentNameRef = useRef<string | null>(null);

  // Subscribe directly to WebSocket copilot channel to avoid event batching loss.
  // Using useSubscription (which stores only the latest event in useState) causes
  // React 18 to batch rapid SDK events, losing intermediate assistant replies.
  const { subscribe } = useWebSocket();

  useEffect(() => {
    if (!sessionId) return;

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

      // Event logging for debugging
      console.log("[LaunchpadHQ Event]", wsEvent.type, wsEvent);

      if (wsEvent.type === "copilot:session-event" && wsEvent.event) {
        const event = wsEvent.event;
        const ts = new Date(event.timestamp).getTime();

        // Capture raw event for debug viewer
        setRawEvents((prev) => [...prev, {
          type: event.type,
          data: event.data as Record<string, unknown>,
          timestamp: ts,
          id: (event as Record<string, unknown>).id as string | undefined,
        }]);

        switch (event.type) {
          case "user.message":
            // User prompts sent from HQ are written to canonical REST history in the
            // send endpoint before the daemon echoes `user.message`. Rendering both
            // sources produces duplicate user rows with different timestamps.
            setQueuedMessage(null);
            void qc.invalidateQueries({ queryKey: ["session-messages", sessionId] });
            void qc.invalidateQueries({ queryKey: ["aggregated-session", sessionId] });
            break;

          case "assistant.message_delta": {
            const delta = (event.data as { deltaContent?: string }).deltaContent ?? "";
            // Use ref for streaming accumulation (synchronous, not subject to batching)
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

          case "assistant.message": {
            // Final assistant message replaces streaming content
            streamingRef.current = null;
            setStreamingEntry(null);
            const msgData = event.data as { content?: string; toolRequests?: unknown[]; parentToolCallId?: string };
            const content = msgData.content ?? "";
            // Capture usage metadata from the preceding assistant.usage event
            const usageMeta = lastUsageRef.current;
            lastUsageRef.current = null;
            // Skip messages with only whitespace content — these are tool-request-only
            // messages where the SDK wraps toolRequests in a near-empty assistant.message.
            if (content.trim()) {
              const eData: Record<string, unknown> = {};
              if (msgData.parentToolCallId) {
                eData.parentToolCallId = msgData.parentToolCallId;
                // Look up the subagent display name from the task tool description
                const subName = subagentNamesRef.current.get(msgData.parentToolCallId);
                if (subName) eData.subagentName = subName;
              } else {
                // Main agent message — attach the agent display name
                if (mainAgentNameRef.current) eData.agentName = mainAgentNameRef.current;
              }
              if (usageMeta) {
                eData.model = usageMeta.model;
                eData.duration = usageMeta.duration;
                eData.inputTokens = usageMeta.inputTokens;
                eData.outputTokens = usageMeta.outputTokens;
                eData.initiator = usageMeta.initiator;
              }
              setRealtimeEntries((prev) => [
                ...prev,
                {
                  id: `rt-asst-${ts}`,
                  type: "assistant",
                  content: content.trim(),
                  timestamp: ts,
                  ...(Object.keys(eData).length > 0 ? { eventData: eData } : {}),
                },
              ]);
            }
            void qc.invalidateQueries({ queryKey: ["session-messages", sessionId] });
            break;
          }

          case "tool.execution_start": {
            const toolData = event.data as { toolCallId?: string; toolName?: string; arguments?: Record<string, unknown> };
            // Save args for correlation with completion
            if (toolData.toolCallId) {
              toolStartsRef.current.set(toolData.toolCallId, toolData.arguments ?? {});
            }
            // Extract description for task tools to use as subagent display name
            if (toolData.toolName === "task" && toolData.toolCallId) {
              const desc = toolData.arguments?.description as string | undefined;
              if (desc) subagentNamesRef.current.set(toolData.toolCallId, desc);
            }
            setRealtimeEntries((prev) => [
              ...prev,
              {
                id: `rt-tool-${ts}`,
                type: "tool",
                content: toolData.toolName ?? "",
                toolName: toolData.toolName,
                toolStatus: "running",
                timestamp: ts,
                eventData: event.data as Record<string, unknown>,
              },
            ]);
            break;
          }

          case "tool.execution_complete": {
            const completeData = event.data as { toolCallId?: string; success?: boolean; result?: { content?: string; detailedContent?: string } };
            // Look up original args from the start event
            const origArgs = completeData.toolCallId ? toolStartsRef.current.get(completeData.toolCallId) : undefined;
            setRealtimeEntries((prev) => {
              const idx = [...prev]
                .reverse()
                .findIndex((e) => e.type === "tool" && e.toolStatus === "running");
              if (idx >= 0) {
                const realIdx = prev.length - 1 - idx;
                const updated = [...prev];
                updated[realIdx] = {
                  ...updated[realIdx],
                  toolStatus: completeData.success ? "completed" : "failed",
                  content: completeData.result?.content ?? updated[realIdx].content,
                  eventData: {
                    ...updated[realIdx].eventData,
                    ...event.data as Record<string, unknown>,
                    ...(origArgs ? { originalArguments: origArgs } : {}),
                  },
                };
                return updated;
              }
              return [
                ...prev,
                {
                  id: `rt-toolcomplete-${ts}`,
                  type: "tool",
                  content: completeData.result?.content ?? "",
                  toolName: "tool",
                  toolStatus: completeData.success ? "completed" : "failed",
                  timestamp: ts,
                  eventData: {
                    ...event.data as Record<string, unknown>,
                    ...(origArgs ? { originalArguments: origArgs } : {}),
                  },
                },
              ];
            });
            break;
          }

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
            // Refresh session status so isProcessing updates immediately
            void qc.invalidateQueries({ queryKey: ["aggregated-session", sessionId] });
            break;

          case "session.error":
            setRealtimeEntries((prev) => [
              ...prev,
              {
                id: `rt-error-${ts}`,
                type: "error",
                content: (event.data as { message?: string }).message ?? "Session error",
                timestamp: ts,
              },
            ]);
            break;

          case "assistant.reasoning_delta": {
            const delta = (event.data as { deltaContent?: string }).deltaContent ?? "";
            if (!reasoningRef.current) {
              reasoningRef.current = { id: `rt-reasoning-${ts}`, content: delta };
            } else {
              reasoningRef.current.content += delta;
            }
            setReasoningEntry({
              id: reasoningRef.current.id,
              type: "event",
              content: reasoningRef.current.content,
              timestamp: ts,
              eventType: "assistant.reasoning",
              isStreaming: true,
            });
            break;
          }

          case "assistant.reasoning":
            reasoningRef.current = null;
            setReasoningEntry(null);
            setRealtimeEntries((prev) => [
              ...prev,
              {
                id: `rt-reasoning-${ts}`,
                type: "event",
                content: (event.data as { content?: string }).content ?? "",
                timestamp: ts,
                eventType: "assistant.reasoning",
              },
            ]);
            break;

          case "assistant.usage": {
            const ud = event.data as { model?: string; duration?: number; inputTokens?: number; outputTokens?: number; initiator?: string };
            lastUsageRef.current = {
              model: ud.model ?? "",
              duration: ud.duration ?? 0,
              inputTokens: ud.inputTokens ?? 0,
              outputTokens: ud.outputTokens ?? 0,
              initiator: ud.initiator ?? "",
            };
            // Still emit as event entry for the inline renderer
            setRealtimeEntries((prev) => [
              ...prev,
              {
                id: `rt-evt-${event.type}-${ts}`,
                type: "event" as const,
                content: formatEventContent(event.type, event.data as Record<string, unknown>),
                timestamp: ts,
                eventType: event.type,
                eventData: event.data as Record<string, unknown>,
              },
            ]);
            break;
          }

          case "subagent.selected": {
            // Track the main agent's display name
            const selData = event.data as { agentDisplayName?: string; agentName?: string };
            mainAgentNameRef.current = selData.agentDisplayName ?? selData.agentName ?? null;
            // Invalidate the agent dropdown query so it refreshes
            void qc.invalidateQueries({ queryKey: ["session-agent", sessionId] });
            // Emit as event entry
            setRealtimeEntries((prev) => [
              ...prev,
              {
                id: `rt-evt-${event.type}-${ts}`,
                type: "event" as const,
                content: formatEventContent(event.type, event.data as Record<string, unknown>),
                timestamp: ts,
                eventType: event.type,
                eventData: event.data as Record<string, unknown>,
              },
            ]);
            break;
          }

          case "system.message": {
            const sysData = event.data as { content?: string; role?: string };
            const role = (sysData.role === "developer" ? "developer" : "system") as "system" | "developer";
            const content = sysData.content ?? "";
            if (steeringTimerRef.current) clearTimeout(steeringTimerRef.current);
            setSteeringMessage({ content, role, timestamp: ts });
            steeringTimerRef.current = setTimeout(() => setSteeringMessage(null), 8000);
            // Also emit as event entry for the timeline
            setRealtimeEntries((prev) => [
              ...prev,
              {
                id: `rt-evt-${event.type}-${ts}`,
                type: "event" as const,
                content: formatEventContent(event.type, event.data as Record<string, unknown>),
                timestamp: ts,
                eventType: event.type,
                eventData: event.data as Record<string, unknown>,
              },
            ]);
            break;
          }

          case "pending_messages.modified":
            // Handled via queuedMessage state — no timeline entry needed
            break;

          default: {
            setRealtimeEntries((prev) => [
              ...prev,
              {
                id: `rt-evt-${event.type}-${ts}`,
                type: "event" as const,
                content: formatEventContent(event.type, event.data as Record<string, unknown>),
                timestamp: ts,
                eventType: event.type,
                eventData: event.data as Record<string, unknown>,
              },
            ]);
            break;
          }
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
    });

    return unsub;
  }, [sessionId, subscribe, qc]);

  // Reset realtime entries when session changes
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
      lastUsageRef.current = null;
      toolStartsRef.current.clear();
      subagentNamesRef.current.clear();
      mainAgentNameRef.current = null;
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

  // Build unified entries list from REST messages + tool invocations + realtime events
  const entries = useCallback((): ConversationEntry[] => {
    const result: ConversationEntry[] = [];

    // 1. Add REST messages
    if (messagesData?.messages) {
      for (const msg of messagesData.messages) {
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

    // 3. Add realtime entries, deduplicating against REST data and within
    //    realtime itself (guards against duplicate daemon event forwarding).
    const seenIds = new Set(result.map((e) => e.id));
    const restTimestamps = new Set(result.map((e) => e.timestamp));
    for (const entry of realtimeEntries) {
      if (seenIds.has(entry.id)) continue;
      if (restTimestamps.has(entry.timestamp)) continue;
      seenIds.add(entry.id);
      result.push(entry);
    }

    // 4. Add streaming entry if present
    if (streamingEntry) {
      result.push(streamingEntry);
    }

    // 5. Add reasoning streaming entry if present
    if (reasoningEntry) {
      result.push(reasoningEntry);
    }

    // Sort by timestamp
    result.sort((a, b) => a.timestamp - b.timestamp);
    return result;
  }, [messagesData, toolsData, realtimeEntries, streamingEntry, reasoningEntry])();

  return {
    entries,
    rawEvents,
    isLoading: messagesLoading,
    isError: messagesError,
    error: messagesErr,
    sessionStatus: session?.status ?? null,
    queuedMessage,
    setQueuedMessage,
    steeringMessage,
    clearSteeringMessage,
  };
}
