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
import { toolTag, toolDescription, toolDetail } from "./tool-tags.js";

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

  // Subagent stack: toolCallIds of active subagent containers (for temporal containment)
  const subagentStackRef = useRef<string[]>([]);

  // Current intent label from report_intent (for grouping tool calls)
  const currentIntentRef = useRef<string | null>(null);

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
            // Clear intent on assistant message (tool group ended)
            currentIntentRef.current = null;
            // Skip messages with only whitespace content — these are tool-request-only
            // messages where the SDK wraps toolRequests in a near-empty assistant.message.
            if (content.trim()) {
              const eData: Record<string, unknown> = {};
              if (msgData.parentToolCallId) {
                eData.parentToolCallId = msgData.parentToolCallId;
                const subName = subagentNamesRef.current.get(msgData.parentToolCallId);
                if (subName) eData.subagentName = subName;
              } else {
                if (mainAgentNameRef.current) eData.agentName = mainAgentNameRef.current;
              }
              if (usageMeta) {
                eData.model = usageMeta.model;
                eData.duration = usageMeta.duration;
                eData.inputTokens = usageMeta.inputTokens;
                eData.outputTokens = usageMeta.outputTokens;
                eData.initiator = usageMeta.initiator;
              }

              const asstEntry: ConversationEntry = {
                id: `rt-asst-${ts}`,
                type: "assistant",
                content: content.trim(),
                timestamp: ts,
                ...(Object.keys(eData).length > 0 ? { eventData: eData } : {}),
              };

              // Route subagent messages into container
              const parentSub = msgData.parentToolCallId ?? subagentStackRef.current[subagentStackRef.current.length - 1];
              if (parentSub) {
                setRealtimeEntries((prev) => {
                  const updated = [...prev];
                  const containerIdx = updated.findIndex(
                    (e) => e.toolCallId === parentSub && e.toolTag === "agent",
                  );
                  if (containerIdx >= 0) {
                    const container = { ...updated[containerIdx] };
                    container.subagentEntries = [...(container.subagentEntries ?? []), asstEntry];
                    updated[containerIdx] = container;
                    return updated;
                  }
                  return [...prev, asstEntry];
                });
              } else {
                setRealtimeEntries((prev) => [...prev, asstEntry]);
              }
            }
            void qc.invalidateQueries({ queryKey: ["session-messages", sessionId] });
            break;
          }

          case "tool.execution_start": {
            const toolData = event.data as { toolCallId?: string; toolName?: string; arguments?: Record<string, unknown> };
            const tName = toolData.toolName ?? "tool";
            const tArgs = toolData.arguments;
            const tCallId = toolData.toolCallId;
            // Save args for correlation with completion
            if (tCallId) {
              toolStartsRef.current.set(tCallId, tArgs ?? {});
            }
            // Extract description for task tools to use as subagent display name
            if (tName === "task" && tCallId) {
              const desc = tArgs?.description as string | undefined;
              if (desc) subagentNamesRef.current.set(tCallId, desc);
            }

            const tag = toolTag(tName, tArgs);
            const desc = toolDescription(tName, tArgs);
            const detail = toolDetail(tName, tArgs);

            // Handle report_intent specially — update intent ref and emit as intent entry
            if (tName === "report_intent") {
              const intent = tArgs?.intent as string | undefined;
              if (intent) currentIntentRef.current = intent;
              setRealtimeEntries((prev) => [
                ...prev,
                {
                  id: `rt-intent-${ts}`,
                  type: "event" as const,
                  content: intent ?? "",
                  timestamp: ts,
                  eventType: "report_intent",
                  toolCallId: tCallId,
                  eventData: event.data as Record<string, unknown>,
                },
              ]);
              break;
            }

            const toolEntry: ConversationEntry = {
              id: `rt-tool-${tCallId ?? ts}`,
              type: "tool",
              content: tName,
              toolName: tName,
              toolStatus: "running",
              timestamp: ts,
              toolCallId: tCallId,
              toolTag: tag,
              toolDescription: desc,
              toolDetail: detail,
              intentLabel: currentIntentRef.current ?? undefined,
              eventData: event.data as Record<string, unknown>,
            };

            // If inside a subagent, add to the container's inner entries
            const activeSubagent = subagentStackRef.current[subagentStackRef.current.length - 1];
            if (activeSubagent && tName !== "task") {
              setRealtimeEntries((prev) => {
                const updated = [...prev];
                const containerIdx = updated.findIndex(
                  (e) => e.toolCallId === activeSubagent && e.toolTag === "agent",
                );
                if (containerIdx >= 0) {
                  const container = { ...updated[containerIdx] };
                  container.subagentEntries = [...(container.subagentEntries ?? []), toolEntry];
                  updated[containerIdx] = container;
                  return updated;
                }
                // Fallback: add as top-level
                return [...prev, toolEntry];
              });
            } else {
              setRealtimeEntries((prev) => [...prev, toolEntry]);
            }
            break;
          }

          case "tool.execution_complete": {
            const completeData = event.data as { toolCallId?: string; toolName?: string; success?: boolean; result?: { content?: string; detailedContent?: string } };
            const cCallId = completeData.toolCallId;
            // Look up original args from the start event
            const origArgs = cCallId ? toolStartsRef.current.get(cCallId) : undefined;
            const cToolName = completeData.toolName ?? (origArgs as Record<string, unknown> | undefined)?.toolName as string ?? "tool";

            // Skip report_intent completions entirely
            if (cToolName === "report_intent" || completeData.result?.content === "Intent logged") {
              break;
            }

            const tag = origArgs ? toolTag(cToolName, origArgs) : undefined;
            const desc = origArgs ? toolDescription(cToolName, origArgs) : undefined;
            const detail = origArgs ? toolDetail(cToolName, origArgs) : undefined;
            const resultContent = completeData.result?.content ?? "";

            // Helper to update a matching running tool entry in an array
            const updateInArray = (entries: ConversationEntry[]): ConversationEntry[] => {
              // Try to find by toolCallId first, then fall back to reverse search for running
              let idx = cCallId
                ? entries.findIndex((e) => e.toolCallId === cCallId && e.type === "tool")
                : -1;
              if (idx < 0) {
                idx = [...entries].reverse().findIndex((e) => e.type === "tool" && e.toolStatus === "running");
                if (idx >= 0) idx = entries.length - 1 - idx;
              }
              if (idx >= 0) {
                const updated = [...entries];
                updated[idx] = {
                  ...updated[idx],
                  toolStatus: completeData.success ? "completed" : "failed",
                  content: resultContent || updated[idx].content,
                  toolResult: resultContent,
                  ...(tag && !updated[idx].toolTag ? { toolTag: tag } : {}),
                  ...(desc && !updated[idx].toolDescription ? { toolDescription: desc } : {}),
                  ...(detail && !updated[idx].toolDetail ? { toolDetail: detail } : {}),
                  eventData: {
                    ...updated[idx].eventData,
                    ...event.data as Record<string, unknown>,
                    ...(origArgs ? { originalArguments: origArgs } : {}),
                  },
                };
                return updated;
              }
              // No matching start — add as standalone completion
              return [
                ...entries,
                {
                  id: `rt-toolcomplete-${ts}`,
                  type: "tool" as const,
                  content: resultContent,
                  toolName: cToolName,
                  toolStatus: (completeData.success ? "completed" : "failed") as "completed" | "failed",
                  timestamp: ts,
                  toolCallId: cCallId,
                  toolTag: tag,
                  toolDescription: desc,
                  toolDetail: detail,
                  toolResult: resultContent,
                  eventData: {
                    ...event.data as Record<string, unknown>,
                    ...(origArgs ? { originalArguments: origArgs } : {}),
                  },
                },
              ];
            };

            // Check if this completion belongs to a subagent container
            const activeSubagent = subagentStackRef.current[subagentStackRef.current.length - 1];
            if (activeSubagent && cCallId !== activeSubagent) {
              setRealtimeEntries((prev) => {
                const updated = [...prev];
                const containerIdx = updated.findIndex(
                  (e) => e.toolCallId === activeSubagent && e.toolTag === "agent",
                );
                if (containerIdx >= 0) {
                  const container = { ...updated[containerIdx] };
                  container.subagentEntries = updateInArray(container.subagentEntries ?? []);
                  updated[containerIdx] = container;
                  return updated;
                }
                // Fallback: update top-level
                return updateInArray(prev);
              });
            } else {
              setRealtimeEntries((prev) => updateInArray(prev));
            }
            break;
          }

          case "session.idle":
            // Don't render idle as a conversation entry — just refresh session status
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
            const ud = event.data as { model?: string; duration?: number; inputTokens?: number; outputTokens?: number; initiator?: string; parentToolCallId?: string };
            lastUsageRef.current = {
              model: ud.model ?? "",
              duration: ud.duration ?? 0,
              inputTokens: ud.inputTokens ?? 0,
              outputTokens: ud.outputTokens ?? 0,
              initiator: ud.initiator ?? "",
            };
            // If inside a subagent, attach model info to the container
            const usageSubagent = ud.parentToolCallId ?? subagentStackRef.current[subagentStackRef.current.length - 1];
            if (usageSubagent) {
              setRealtimeEntries((prev) => {
                const updated = [...prev];
                const containerIdx = updated.findIndex(
                  (e) => e.toolCallId === usageSubagent && e.toolTag === "agent",
                );
                if (containerIdx >= 0) {
                  const container = { ...updated[containerIdx] };
                  container.subagentModel = ud.model;
                  if (ud.duration) container.subagentDuration = ud.duration;
                  updated[containerIdx] = container;
                  return updated;
                }
                return prev;
              });
            }
            // Absorbed into assistant message — no separate entry
            break;
          }

          case "subagent.selected": {
            // Track the main agent's display name — hidden from conversation
            const selData = event.data as { agentDisplayName?: string; agentName?: string };
            mainAgentNameRef.current = selData.agentDisplayName ?? selData.agentName ?? null;
            void qc.invalidateQueries({ queryKey: ["session-agent", sessionId] });
            break;
          }

          case "subagent.started": {
            // Push onto subagent stack for temporal containment
            const startData = event.data as { toolCallId?: string; agentDisplayName?: string; agentName?: string };
            const subCallId = startData.toolCallId;
            if (subCallId) {
              subagentStackRef.current = [...subagentStackRef.current, subCallId];
              // Find the matching task tool entry and mark it as a subagent container
              setRealtimeEntries((prev) => {
                const updated = [...prev];
                const idx = updated.findIndex((e) => e.toolCallId === subCallId && e.toolTag === "agent");
                if (idx >= 0) {
                  updated[idx] = {
                    ...updated[idx],
                    subagentStatus: "running",
                    subagentEntries: updated[idx].subagentEntries ?? [],
                    eventData: {
                      ...updated[idx].eventData,
                      agentDisplayName: startData.agentDisplayName,
                      agentName: startData.agentName,
                    },
                  };
                }
                return updated;
              });
            }
            break;
          }

          case "subagent.completed": {
            // Pop from subagent stack
            const compData = event.data as { toolCallId?: string };
            const compCallId = compData.toolCallId;
            if (compCallId) {
              subagentStackRef.current = subagentStackRef.current.filter((id) => id !== compCallId);
              setRealtimeEntries((prev) => {
                const updated = [...prev];
                const idx = updated.findIndex((e) => e.toolCallId === compCallId && e.toolTag === "agent");
                if (idx >= 0) {
                  updated[idx] = {
                    ...updated[idx],
                    subagentStatus: "done",
                  };
                }
                return updated;
              });
            }
            break;
          }

          case "subagent.failed": {
            const failData = event.data as { toolCallId?: string; error?: string };
            const failCallId = failData.toolCallId;
            if (failCallId) {
              subagentStackRef.current = subagentStackRef.current.filter((id) => id !== failCallId);
              setRealtimeEntries((prev) => {
                const updated = [...prev];
                const idx = updated.findIndex((e) => e.toolCallId === failCallId && e.toolTag === "agent");
                if (idx >= 0) {
                  updated[idx] = {
                    ...updated[idx],
                    subagentStatus: "failed",
                    eventData: {
                      ...updated[idx].eventData,
                      error: failData.error,
                    },
                  };
                }
                return updated;
              });
            }
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
      subagentStackRef.current = [];
      currentIntentRef.current = null;
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
