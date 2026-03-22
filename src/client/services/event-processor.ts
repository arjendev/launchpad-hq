/**
 * Extracted event processing logic — shared between the WebSocket live handler
 * and the REST historical-events loader.
 *
 * processSessionEvent()  — handles a single SDK event
 * processEventBatch()    — replays an array of events into ConversationEntry[]
 */

import type { ConversationEntry } from "./types.js";
import { toolTag, toolDescription, toolDetail } from "./tool-tags.js";

// ── Public types ───────────────────────────────────────

/** Raw SDK event as surfaced to the debug panel */
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

/** Cross-event mutable state — populated chronologically */
export interface EventProcessorRefs {
  toolStarts: Map<string, Record<string, unknown>>;
  subagentNames: Map<string, string>;
  mainAgentName: string | null;
  subagentStack: string[];
  currentIntent: string | null;
  subagentContent: Set<string>;
  lastUsage: {
    model: string;
    duration: number;
    inputTokens: number;
    outputTokens: number;
    initiator: string;
  } | null;
  streaming: { id: string; content: string } | null;
  reasoning: { id: string; content: string } | null;
}

/** Callbacks wired by the caller (React setters for live, no-ops for batch) */
export interface EventProcessorCallbacks {
  updateEntries: (fn: (entries: ConversationEntry[]) => ConversationEntry[]) => void;
  setStreamingEntry?: (entry: ConversationEntry | null) => void;
  setReasoningEntry?: (entry: ConversationEntry | null) => void;
  setQueuedMessage?: (msg: string | null) => void;
  setSteeringMessage?: (msg: SteeringMessage | null) => void;
  scheduleSteeringClear?: (ms: number) => void;
  invalidateQueries?: (keys: string[][]) => void;
  captureRawEvent?: (event: RawSessionEvent) => void;
}

export type ProcessorMode = "live" | "batch";

export interface SessionEventInput {
  type: string;
  data: Record<string, unknown>;
  timestamp?: string | number;
  id?: string;
}

// ── Helpers ────────────────────────────────────────────

export function createEmptyRefs(): EventProcessorRefs {
  return {
    toolStarts: new Map(),
    subagentNames: new Map(),
    mainAgentName: null,
    subagentStack: [],
    currentIntent: null,
    subagentContent: new Set(),
    lastUsage: null,
    streaming: null,
    reasoning: null,
  };
}

function normalizeForDedup(s: string): string {
  return s
    .trim()
    .replace(/\*\*/g, "")
    .replace(/\p{Emoji_Presentation}/gu, "")
    .replace(/\p{Emoji}\uFE0F?/gu, "")
    .replace(/^[^a-zA-Z0-9]*/, "")
    .trim();
}

export function formatEventContent(
  eventType: string,
  data: Record<string, unknown>,
): string {
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
      return `Model changed to ${data.newModel ?? data.model ?? "unknown"}`;
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
        .map(
          ([k, v]) =>
            `${k}: ${typeof v === "string" ? v.slice(0, 80) : JSON.stringify(v)}`,
        )
        .join(", ");
      return summary || eventType;
    }
  }
}

// ── Infrastructure tools to hide ──────────────────────

const INFRA_TOOLS = new Set([
  "read_agent",
  "write_agent",
  "list_agents",
  "stop_bash",
]);

// ── Core processor ────────────────────────────────────

/**
 * Process a single SDK event, mutating refs and calling callbacks.
 *
 * In "live" mode (WebSocket): captures raw events, triggers query invalidation,
 * drives streaming/reasoning delta state.
 *
 * In "batch" mode (REST replay): skips deltas, creates user entries directly,
 * no query invalidation. Used to rebuild entries from historical events.
 */
export function processSessionEvent(
  event: SessionEventInput,
  sessionId: string,
  refs: EventProcessorRefs,
  callbacks: EventProcessorCallbacks,
  mode: ProcessorMode = "live",
): void {
  const ts =
    typeof event.timestamp === "string"
      ? new Date(event.timestamp).getTime()
      : (event.timestamp ?? Date.now());

  // Capture raw event for debug viewer (live only)
  if (mode === "live") {
    callbacks.captureRawEvent?.({
      type: event.type,
      data: event.data,
      timestamp: ts,
      id: event.id,
    });
  }

  switch (event.type) {
    // ── User message ──────────────────────────────────
    case "user.message": {
      if (mode === "live") {
        callbacks.setQueuedMessage?.(null);
        callbacks.invalidateQueries?.([
          ["session-messages", sessionId],
          ["aggregated-session", sessionId],
        ]);
      } else {
        // Batch: produce user entry directly
        const content = (event.data as { content?: string }).content ?? "";
        if (content.trim()) {
          callbacks.updateEntries((prev) => [
            ...prev,
            {
              id: `evt-user-${ts}-${event.id ?? ""}`,
              type: "user" as const,
              content: content.trim(),
              timestamp: ts,
            },
          ]);
        }
      }
      break;
    }

    // ── Streaming delta ───────────────────────────────
    case "assistant.message_delta": {
      if (mode === "batch") break;
      const delta =
        (event.data as { deltaContent?: string }).deltaContent ?? "";
      if (!refs.streaming) {
        refs.streaming = { id: `rt-stream-${ts}`, content: delta };
      } else {
        refs.streaming.content += delta;
      }
      callbacks.setStreamingEntry?.({
        id: refs.streaming.id,
        type: "assistant",
        content: refs.streaming.content,
        timestamp: ts,
        isStreaming: true,
      });
      break;
    }

    // ── Final assistant message ───────────────────────
    case "assistant.message": {
      refs.streaming = null;
      callbacks.setStreamingEntry?.(null);

      const msgData = event.data as {
        content?: string;
        toolRequests?: unknown[];
        parentToolCallId?: string;
      };
      const content = msgData.content ?? "";
      const usageMeta = refs.lastUsage;
      refs.lastUsage = null;
      refs.currentIntent = null;

      if (!content.trim()) break;

      const eData: Record<string, unknown> = {};
      const isSubagentMsg = !!msgData.parentToolCallId;
      if (isSubagentMsg) {
        eData.parentToolCallId = msgData.parentToolCallId;
        const subName = refs.subagentNames.get(msgData.parentToolCallId!);
        if (subName) eData.subagentName = subName;
      } else {
        if (refs.mainAgentName) eData.agentName = refs.mainAgentName;
      }
      if (usageMeta) {
        eData.model = usageMeta.model;
        eData.duration = usageMeta.duration;
        eData.inputTokens = usageMeta.inputTokens;
        eData.outputTokens = usageMeta.outputTokens;
        eData.initiator = usageMeta.initiator;
      }

      // Dedup: track subagent content; suppress parent echoes
      const normalized = normalizeForDedup(content);
      if (isSubagentMsg) {
        refs.subagentContent.add(normalized);
        if (normalized.length > 40)
          refs.subagentContent.add(normalized.slice(0, 40));
        if (normalized.length > 20)
          refs.subagentContent.add(normalized.slice(0, 20));
      } else if (refs.subagentContent.size > 0) {
        const isEcho = [...refs.subagentContent].some(
          (sub) => normalized.includes(sub) || sub.includes(normalized),
        );
        if (isEcho) {
          refs.subagentContent.clear();
          if (mode === "live") {
            callbacks.invalidateQueries?.([
              ["session-messages", sessionId],
            ]);
          }
          break;
        }
      }

      const asstEntry: ConversationEntry = {
        id: `rt-asst-${ts}`,
        type: "assistant",
        content: content.trim(),
        timestamp: ts,
        ...(Object.keys(eData).length > 0 ? { eventData: eData } : {}),
      };

      // Route subagent messages into container
      const parentSub =
        msgData.parentToolCallId ??
        refs.subagentStack[refs.subagentStack.length - 1];
      if (parentSub) {
        callbacks.updateEntries((prev) => {
          const updated = [...prev];
          const containerIdx = updated.findIndex(
            (e) => e.toolCallId === parentSub && e.toolTag === "agent",
          );
          if (containerIdx >= 0) {
            const container = { ...updated[containerIdx] };
            container.subagentEntries = [
              ...(container.subagentEntries ?? []),
              asstEntry,
            ];
            updated[containerIdx] = container;
            return updated;
          }
          return [...prev, asstEntry];
        });
      } else {
        callbacks.updateEntries((prev) => [...prev, asstEntry]);
      }
      if (mode === "live") {
        callbacks.invalidateQueries?.([["session-messages", sessionId]]);
      }
      break;
    }

    // ── Tool execution start ──────────────────────────
    case "tool.execution_start": {
      const toolData = event.data as {
        toolCallId?: string;
        toolName?: string;
        arguments?: Record<string, unknown>;
        parentToolCallId?: string;
      };
      const tName = toolData.toolName ?? "tool";
      const tArgs = toolData.arguments;
      const tCallId = toolData.toolCallId;
      const parentTool = toolData.parentToolCallId;

      // Hide infrastructure tools
      if (INFRA_TOOLS.has(tName)) {
        if (tCallId)
          refs.toolStarts.set(tCallId, {
            ...(tArgs ?? {}),
            _infraTool: true,
          });
        break;
      }

      if (tCallId) {
        refs.toolStarts.set(tCallId, tArgs ?? {});
      }
      if (tName === "task" && tCallId) {
        const desc = tArgs?.description as string | undefined;
        if (desc) refs.subagentNames.set(tCallId, desc);
      }

      const tag = toolTag(tName, tArgs);
      const desc = toolDescription(tName, tArgs);
      const detail = toolDetail(tName, tArgs);

      const owningSubagent =
        parentTool ?? refs.subagentStack[refs.subagentStack.length - 1];

      // Handle report_intent
      if (tName === "report_intent") {
        const intent = tArgs?.intent as string | undefined;
        if (intent) refs.currentIntent = intent;
        const intentEntry: ConversationEntry = {
          id: `rt-intent-${ts}`,
          type: "event" as const,
          content: intent ?? "",
          timestamp: ts,
          eventType: "report_intent",
          toolCallId: tCallId,
          eventData: event.data,
        };
        if (owningSubagent) {
          callbacks.updateEntries((prev) => {
            const updated = [...prev];
            const containerIdx = updated.findIndex(
              (e) =>
                e.toolCallId === owningSubagent && e.toolTag === "agent",
            );
            if (containerIdx >= 0) {
              const container = { ...updated[containerIdx] };
              container.subagentEntries = [
                ...(container.subagentEntries ?? []),
                intentEntry,
              ];
              updated[containerIdx] = container;
              return updated;
            }
            return [...prev, intentEntry];
          });
        } else {
          callbacks.updateEntries((prev) => [...prev, intentEntry]);
        }
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
        intentLabel: refs.currentIntent ?? undefined,
        eventData: event.data,
      };

      if (owningSubagent && tName !== "task") {
        callbacks.updateEntries((prev) => {
          const updated = [...prev];
          const containerIdx = updated.findIndex(
            (e) =>
              e.toolCallId === owningSubagent && e.toolTag === "agent",
          );
          if (containerIdx >= 0) {
            const container = { ...updated[containerIdx] };
            container.subagentEntries = [
              ...(container.subagentEntries ?? []),
              toolEntry,
            ];
            updated[containerIdx] = container;
            return updated;
          }
          return [...prev, toolEntry];
        });
      } else {
        callbacks.updateEntries((prev) => [...prev, toolEntry]);
      }
      break;
    }

    // ── Tool execution complete ───────────────────────
    case "tool.execution_complete": {
      const completeData = event.data as {
        toolCallId?: string;
        toolName?: string;
        success?: boolean;
        result?: { content?: string; detailedContent?: string };
        parentToolCallId?: string;
      };
      const cCallId = completeData.toolCallId;
      const origArgs = cCallId
        ? refs.toolStarts.get(cCallId)
        : undefined;
      const cToolName = completeData.toolName ?? "tool";
      const cParentTool = completeData.parentToolCallId;

      // Skip infrastructure tools
      if (origArgs && (origArgs as Record<string, unknown>)._infraTool) {
        break;
      }

      // Skip report_intent completions
      if (
        cToolName === "report_intent" ||
        completeData.result?.content === "Intent logged"
      ) {
        break;
      }

      // task tool completions: update toolStatus only
      if (cToolName === "task" && cCallId) {
        callbacks.updateEntries((prev) => {
          const updated = [...prev];
          const containerIdx = updated.findIndex(
            (e) => e.toolCallId === cCallId && e.toolTag === "agent",
          );
          if (containerIdx >= 0) {
            const container = { ...updated[containerIdx] };
            container.toolStatus = completeData.success
              ? "completed"
              : "failed";
            updated[containerIdx] = container;
            return updated;
          }
          return prev;
        });
        break;
      }

      const tag = origArgs ? toolTag(cToolName, origArgs) : undefined;
      const desc = origArgs
        ? toolDescription(cToolName, origArgs)
        : undefined;
      const detail = origArgs
        ? toolDetail(cToolName, origArgs)
        : undefined;
      const resultContent = completeData.result?.content ?? "";

      const updateInArray = (
        entries: ConversationEntry[],
      ): ConversationEntry[] => {
        let idx = cCallId
          ? entries.findIndex(
              (e) => e.toolCallId === cCallId && e.type === "tool",
            )
          : -1;
        if (idx < 0) {
          idx = [...entries]
            .reverse()
            .findIndex(
              (e) => e.type === "tool" && e.toolStatus === "running",
            );
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
            ...(desc && !updated[idx].toolDescription
              ? { toolDescription: desc }
              : {}),
            ...(detail && !updated[idx].toolDetail
              ? { toolDetail: detail }
              : {}),
            eventData: {
              ...updated[idx].eventData,
              ...(event.data as Record<string, unknown>),
              ...(origArgs ? { originalArguments: origArgs } : {}),
            },
          };
          return updated;
        }
        // No matching start — standalone completion
        return [
          ...entries,
          {
            id: `rt-toolcomplete-${ts}`,
            type: "tool" as const,
            content: resultContent,
            toolName: cToolName,
            toolStatus: (
              completeData.success ? "completed" : "failed"
            ) as "completed" | "failed",
            timestamp: ts,
            toolCallId: cCallId,
            toolTag: tag,
            toolDescription: desc,
            toolDetail: detail,
            toolResult: resultContent,
            eventData: {
              ...(event.data as Record<string, unknown>),
              ...(origArgs ? { originalArguments: origArgs } : {}),
            },
          },
        ];
      };

      const completeOwner =
        cParentTool ??
        refs.subagentStack[refs.subagentStack.length - 1];
      if (completeOwner && cCallId !== completeOwner) {
        callbacks.updateEntries((prev) => {
          const updated = [...prev];
          const containerIdx = updated.findIndex(
            (e) =>
              e.toolCallId === completeOwner && e.toolTag === "agent",
          );
          if (containerIdx >= 0) {
            const container = { ...updated[containerIdx] };
            container.subagentEntries = updateInArray(
              container.subagentEntries ?? [],
            );
            updated[containerIdx] = container;
            return updated;
          }
          return updateInArray(prev);
        });
      } else {
        callbacks.updateEntries((prev) => updateInArray(prev));
      }
      break;
    }

    // ── Session lifecycle ─────────────────────────────
    case "session.idle":
      if (mode === "live") {
        callbacks.invalidateQueries?.([
          ["aggregated-session", sessionId],
        ]);
      }
      break;

    case "session.error":
      callbacks.updateEntries((prev) => [
        ...prev,
        {
          id: `rt-error-${ts}`,
          type: "error",
          content:
            (event.data as { message?: string }).message ??
            "Session error",
          timestamp: ts,
        },
      ]);
      break;

    // ── Reasoning delta ───────────────────────────────
    case "assistant.reasoning_delta": {
      if (mode === "batch") break;
      const delta =
        (event.data as { deltaContent?: string }).deltaContent ?? "";
      if (!refs.reasoning) {
        refs.reasoning = { id: `rt-reasoning-${ts}`, content: delta };
      } else {
        refs.reasoning.content += delta;
      }
      callbacks.setReasoningEntry?.({
        id: refs.reasoning.id,
        type: "event",
        content: refs.reasoning.content,
        timestamp: ts,
        eventType: "assistant.reasoning",
        isStreaming: true,
      });
      break;
    }

    // ── Reasoning final ───────────────────────────────
    case "assistant.reasoning":
      refs.reasoning = null;
      callbacks.setReasoningEntry?.(null);
      callbacks.updateEntries((prev) => [
        ...prev,
        {
          id: `rt-reasoning-${ts}`,
          type: "event",
          content:
            (event.data as { content?: string }).content ?? "",
          timestamp: ts,
          eventType: "assistant.reasoning",
        },
      ]);
      break;

    // ── Usage metadata ────────────────────────────────
    case "assistant.usage": {
      const ud = event.data as {
        model?: string;
        duration?: number;
        inputTokens?: number;
        outputTokens?: number;
        initiator?: string;
        parentToolCallId?: string;
      };
      refs.lastUsage = {
        model: ud.model ?? "",
        duration: ud.duration ?? 0,
        inputTokens: ud.inputTokens ?? 0,
        outputTokens: ud.outputTokens ?? 0,
        initiator: ud.initiator ?? "",
      };
      const usageSubagent =
        ud.parentToolCallId ??
        refs.subagentStack[refs.subagentStack.length - 1];
      if (usageSubagent) {
        callbacks.updateEntries((prev) => {
          const updated = [...prev];
          const containerIdx = updated.findIndex(
            (e) =>
              e.toolCallId === usageSubagent && e.toolTag === "agent",
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
      break;
    }

    // ── Subagent lifecycle ────────────────────────────
    case "subagent.selected": {
      const selData = event.data as {
        agentDisplayName?: string;
        agentName?: string;
      };
      refs.mainAgentName =
        selData.agentDisplayName ?? selData.agentName ?? null;
      if (mode === "live") {
        callbacks.invalidateQueries?.([
          ["session-agent", sessionId],
        ]);
      }
      break;
    }

    case "subagent.started": {
      const startData = event.data as {
        toolCallId?: string;
        agentDisplayName?: string;
        agentName?: string;
      };
      const subCallId = startData.toolCallId;
      if (subCallId) {
        refs.subagentStack = [...refs.subagentStack, subCallId];
        callbacks.updateEntries((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex(
            (e) => e.toolCallId === subCallId && e.toolTag === "agent",
          );
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
      const compData = event.data as { toolCallId?: string };
      const compCallId = compData.toolCallId;
      if (compCallId) {
        refs.subagentStack = refs.subagentStack.filter(
          (id) => id !== compCallId,
        );
        callbacks.updateEntries((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex(
            (e) => e.toolCallId === compCallId && e.toolTag === "agent",
          );
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], subagentStatus: "done" };
          }
          return updated;
        });
      }
      break;
    }

    case "subagent.failed": {
      const failData = event.data as {
        toolCallId?: string;
        error?: string;
      };
      const failCallId = failData.toolCallId;
      if (failCallId) {
        refs.subagentStack = refs.subagentStack.filter(
          (id) => id !== failCallId,
        );
        callbacks.updateEntries((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex(
            (e) => e.toolCallId === failCallId && e.toolTag === "agent",
          );
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

    // ── System / steering messages ────────────────────
    case "system.message": {
      const sysData = event.data as {
        content?: string;
        role?: string;
      };
      const role = (
        sysData.role === "developer" ? "developer" : "system"
      ) as "system" | "developer";
      const content = sysData.content ?? "";
      if (mode === "live") {
        callbacks.setSteeringMessage?.({ content, role, timestamp: ts });
        callbacks.scheduleSteeringClear?.(8000);
      }
      callbacks.updateEntries((prev) => [
        ...prev,
        {
          id: `rt-evt-${event.type}-${ts}`,
          type: "event" as const,
          content: formatEventContent(event.type, event.data),
          timestamp: ts,
          eventType: event.type,
          eventData: event.data,
        },
      ]);
      break;
    }

    case "pending_messages.modified":
      break;

    case "session.model_change":
      if (mode === "live") {
        callbacks.invalidateQueries?.([
          ["aggregated-session", sessionId],
        ]);
      }
      break;

    // ── HQ tool invocation (may appear in events API) ─
    case "copilot:tool-invocation": {
      const toolEvt = event.data as {
        tool?: string;
        args?: Record<string, unknown>;
      };
      callbacks.updateEntries((prev) => [
        ...prev,
        {
          id: `rt-hqtool-${ts}`,
          type: "hq-tool" as const,
          content: "",
          hqToolName: toolEvt.tool,
          hqToolArgs: toolEvt.args,
          timestamp: ts,
        },
      ]);
      break;
    }

    // ── Default: generic event entry ──────────────────
    default: {
      callbacks.updateEntries((prev) => [
        ...prev,
        {
          id: `rt-evt-${event.type}-${ts}`,
          type: "event" as const,
          content: formatEventContent(event.type, event.data),
          timestamp: ts,
          eventType: event.type,
          eventData: event.data,
        },
      ]);
      break;
    }
  }
}

// ── Batch processor ───────────────────────────────────

/**
 * Process an array of historical events (oldest-first) into ConversationEntry[].
 * Returns the entries and the populated refs (which can seed the live handler).
 */
export function processEventBatch(
  events: SessionEventInput[],
  sessionId: string,
  existingRefs?: EventProcessorRefs,
): { entries: ConversationEntry[]; refs: EventProcessorRefs } {
  const refs = existingRefs ?? createEmptyRefs();
  let entries: ConversationEntry[] = [];

  const callbacks: EventProcessorCallbacks = {
    updateEntries: (fn) => {
      entries = fn(entries);
    },
    // All other callbacks are undefined → no-ops in processSessionEvent
  };

  for (const event of events) {
    processSessionEvent(event, sessionId, refs, callbacks, "batch");
  }

  return { entries, refs };
}
