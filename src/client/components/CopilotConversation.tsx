import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Code,
  Collapse,
  Divider,
  Group,
  Loader,
  NativeSelect,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  useAggregatedSession,
  useConversationEntries,
  useSendPrompt,
  useAbortSession,
  useCopilotAgentCatalog,
  useGetSessionAgent,
  useListModels,
  useSetModel,
  useSetSessionAgent,
  useSetMode,
  useGetPlan,
  useDeletePlan,
} from "../services/hooks.js";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import type {
  CopilotSessionMode,
  ConversationEntry,
  PromptDeliveryMode,
  AggregatedSession,
} from "../services/types.js";
import { DEFAULT_SESSION_ACTIVITY } from "../services/types.js";

// ── Props ──────────────────────────────────────────────

export interface CopilotConversationProps {
  sessionId: string;
  sessionType?: string;
  controlPanelOpen?: boolean;
}

// ── Individual message components (memoized) ───────────

const UserMessage = memo(function UserMessage({ entry, expanded }: { entry: ConversationEntry; expanded?: boolean }) {
  const [showTransformed, setShowTransformed] = useState(false);
  const transformedContent = entry.eventData?.transformedContent as string | undefined;

  return (
    <Group justify="flex-end" data-testid="user-message">
      <Paper
        p="xs"
        radius="md"
        style={{
          backgroundColor: "var(--lp-accent)",
          color: "#fff",
          maxWidth: "80%",
        }}
      >
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {entry.content}
        </Text>
        {expanded && transformedContent && (
          <Box mt={4}>
            <Text
              size="xs"
              style={{ cursor: "pointer", opacity: 0.7 }}
              onClick={() => setShowTransformed((v) => !v)}
            >
              {showTransformed ? "▲ Hide" : "▼ Show"} transformed content ({(transformedContent.length / 1024).toFixed(1)}KB)
            </Text>
            <Collapse in={showTransformed}>
              <Code block style={{ fontSize: 10, maxHeight: 300, overflow: "auto", marginTop: 4, color: "#fff", backgroundColor: "rgba(0,0,0,0.3)", whiteSpace: "pre-wrap" }}>
                {transformedContent}
              </Code>
            </Collapse>
          </Box>
        )}
      </Paper>
    </Group>
  );
});

const AssistantMessage = memo(function AssistantMessage({
  entry,
}: {
  entry: ConversationEntry;
}) {
  if (!entry.content.trim() && !entry.isStreaming) return null;

  const data = entry.eventData ?? {};
  const parentToolCallId = data.parentToolCallId as string | undefined;
  const isSubagentMessage = !!parentToolCallId;
  const model = data.model as string | undefined;
  const duration = data.duration as number | undefined;
  const inputTokens = data.inputTokens as number | undefined;
  const outputTokens = data.outputTokens as number | undefined;
  const initiator = data.initiator as string | undefined;
  const subagentName = data.subagentName as string | undefined;
  const mainAgentName = data.agentName as string | undefined;
  const agentLabel = isSubagentMessage
    ? (subagentName ?? "Sub-agent")
    : (mainAgentName ?? (initiator === "agent" ? "Agent" : undefined));

  return (
    <Group justify="flex-start" data-testid="assistant-message">
      <Paper
        p="xs"
        radius="md"
        withBorder
        style={{
          maxWidth: "80%",
          ...(isSubagentMessage ? {
            borderColor: "var(--mantine-color-violet-4)",
            borderLeftWidth: 3,
          } : {}),
        }}
      >
        {/* Agent name + model annotation */}
        {(agentLabel || model) && (
          <Group gap={4} mb={2}>
            {agentLabel && (
              <Text size="xs" c={isSubagentMessage ? "violet" : "dimmed"} fw={500}>
                🤖 {agentLabel}
              </Text>
            )}
            {model && (
              <Text size="xs" c="dimmed">
                · {model}
              </Text>
            )}
          </Group>
        )}
        {entry.content.trim() && (
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {entry.content}
          </Text>
        )}
        {entry.isStreaming && (
          <Group gap={4} mt={entry.content.trim() ? 4 : 0}>
            <Loader size={12} type="dots" />
            {!entry.content.trim() && (
              <Text size="xs" c="dimmed">
                typing…
              </Text>
            )}
          </Group>
        )}
        {/* Timing annotation */}
        {duration != null && (
          <Text size="xs" c="dimmed" mt={2}>
            ⏱ {(duration / 1000).toFixed(1)}s
            {inputTokens != null ? ` · ${inputTokens.toLocaleString()} in` : ""}
            {outputTokens != null ? ` / ${outputTokens.toLocaleString()} out` : ""}
          </Text>
        )}
      </Paper>
    </Group>
  );
});

const HqToolCard = memo(function HqToolCard({ entry }: { entry: ConversationEntry }) {
  const toolEmoji =
    entry.hqToolName === "report_progress"
      ? "📊"
      : entry.hqToolName === "request_human_review"
        ? "👁️"
        : "🚫";

  const summary = entry.hqToolArgs
    ? Object.entries(entry.hqToolArgs)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join("\n")
    : "";

  return (
    <Group justify="flex-start" data-testid="hq-tool-card">
      <Paper
        p="xs"
        radius="sm"
        style={{
          maxWidth: "80%",
          backgroundColor: "var(--lp-warning)",
          color: "#000",
          opacity: 0.95,
        }}
      >
        <Group gap="xs" wrap="nowrap">
          <Text size="sm">{toolEmoji}</Text>
          <Text size="sm" fw={600}>
            {entry.hqToolName}
          </Text>
        </Group>
        {summary && (
          <Text size="xs" mt={2} style={{ whiteSpace: "pre-wrap" }}>
            {summary}
          </Text>
        )}
      </Paper>
    </Group>
  );
});

const StatusDivider = memo(function StatusDivider({
  entry,
}: {
  entry: ConversationEntry;
}) {
  return (
    <Divider
      label={entry.content}
      labelPosition="center"
      color="dimmed"
      data-testid="status-divider"
    />
  );
});

const ErrorBanner = memo(function ErrorBanner({
  entry,
}: {
  entry: ConversationEntry;
}) {
  return (
    <Paper
      p="xs"
      radius="sm"
      data-testid="error-banner"
      style={{
        backgroundColor: "var(--lp-error)",
        color: "#fff",
      }}
    >
      <Text size="sm" fw={500}>
        ⚠ {entry.content}
      </Text>
    </Paper>
  );
});

// ── Multi-agent awareness components ───────────────────

const PermissionRequestCard = memo(function PermissionRequestCard({
  sessionId,
  requestId,
  toolName,
  toolArgs,
}: {
  sessionId: string;
  requestId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}) {
  const [decided, setDecided] = useState(false);

  const handleDecision = async (decision: "allow" | "deny") => {
    await fetch(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/permission-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, decision }),
    });
    setDecided(true);
  };

  return (
    <Paper withBorder p="xs" radius="sm" style={{ borderColor: "var(--mantine-color-yellow-4)", borderStyle: "dashed" }}>
      <Stack gap={4}>
        <Group gap="xs">
          <Badge size="xs" color="yellow">🔐 Permission</Badge>
          <Text size="sm" fw={500}>Agent wants to use: {toolName}</Text>
        </Group>
        {toolArgs && Object.keys(toolArgs).length > 0 && (
          <Code block style={{ fontSize: "0.75rem", maxHeight: 100, overflow: "auto" }}>
            {JSON.stringify(toolArgs, null, 2)}
          </Code>
        )}
        {!decided && (
          <Group gap="xs">
            <Button size="xs" color="green" variant="light" onClick={() => handleDecision("allow")}>
              ✅ Allow
            </Button>
            <Button size="xs" color="red" variant="light" onClick={() => handleDecision("deny")}>
              ❌ Deny
            </Button>
          </Group>
        )}
        {decided && (
          <Text size="xs" c="dimmed">Decision submitted</Text>
        )}
      </Stack>
    </Paper>
  );
});

const UserInputRequestCard = memo(function UserInputRequestCard({
  sessionId,
  requestId,
  question,
  choices,
}: {
  sessionId: string;
  requestId: string;
  question: string;
  choices?: string[];
}) {
  const [answered, setAnswered] = useState(false);
  const [answer, setAnswer] = useState("");

  const handleSubmit = async (selectedAnswer: string, wasFreeform: boolean) => {
    await fetch(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/user-input-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, answer: selectedAnswer, wasFreeform }),
    });
    setAnswered(true);
  };

  return (
    <Paper withBorder p="xs" radius="sm" style={{ borderColor: "var(--mantine-color-blue-4)", borderStyle: "dashed" }}>
      <Stack gap={4}>
        <Group gap="xs">
          <Badge size="xs" color="blue">❓ Agent Question</Badge>
        </Group>
        <Text size="sm">{question}</Text>
        {!answered && choices && choices.length > 0 && (
          <Group gap="xs" wrap="wrap">
            {choices.map((c) => (
              <Button key={c} size="xs" variant="light" onClick={() => handleSubmit(c, false)}>
                {c}
              </Button>
            ))}
          </Group>
        )}
        {!answered && (
          <Group gap="xs">
            <TextInput
              size="xs"
              placeholder="Type your answer..."
              value={answer}
              onChange={(e) => setAnswer(e.currentTarget.value)}
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && answer.trim()) {
                  handleSubmit(answer, true);
                }
              }}
            />
            <Button size="xs" onClick={() => handleSubmit(answer, true)} disabled={!answer.trim()}>
              Send
            </Button>
          </Group>
        )}
        {answered && <Text size="xs" c="dimmed">Answer submitted</Text>}
      </Stack>
    </Paper>
  );
});

// ── Noise filter — events we never show inline ─────────

const HIDDEN_EVENT_TYPES = new Set([
  "pending_messages.modified",
  "session.tools_updated",
  "hook.start",
  "hook.end",
  "permission.completed",
  "session.background_tasks_changed",
  "subagent.selected",
  "assistant.turn_end",
  "session.idle",
  "session.start",
  "session.resume",
  "session.model_change",
  "session.mode_changed",
  "session.plan_changed",
  "session.updated",
  "session.context_changed",
]);

// ── Smart inline renderers ─────────────────────────────

/** Thin turn divider: ── Turn 2 ── ⏱ 7.0s */
const TurnDivider = memo(function TurnDivider({ entry }: { entry: ConversationEntry }) {
  const turnId = entry.eventData?.turnId as string | undefined;
  const label = turnId != null ? `Turn ${turnId}` : "New turn";
  return (
    <Divider
      label={<Text size="xs" c="dimmed">{`── ${label} ──`}</Text>}
      labelPosition="center"
      color="dimmed"
      my={4}
      data-testid="turn-divider"
    />
  );
});

/** ⏱ Usage line — shows model timing inline */
const UsageLine = memo(function UsageLine({ entry }: { entry: ConversationEntry }) {
  const data = entry.eventData ?? {};
  const duration = data.duration as number | undefined;
  const model = data.model as string | undefined;
  const input = data.inputTokens as number | undefined;
  const output = data.outputTokens as number | undefined;
  const initiator = data.initiator as string | undefined;
  if (!duration) return null;
  const prefix = initiator === "sub-agent" ? "🤖" : "⏱";
  return (
    <Text size="xs" c="dimmed" data-testid="usage-line" ml="sm">
      {prefix} {(duration / 1000).toFixed(1)}s
      {model ? ` · ${model}` : ""}
      {input != null ? ` · ${input.toLocaleString()} in` : ""}
      {output != null ? ` / ${output.toLocaleString()} out` : ""}
    </Text>
  );
});

/** 🔧 Tool one-liner — shows tool name + intent/description, expandable to args + result */
const InlineToolStart = memo(function InlineToolStart({ entry, expanded: globalExpanded }: { entry: ConversationEntry; expanded?: boolean }) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const showDetail = globalExpanded || localExpanded;
  const data = entry.eventData ?? {};
  const toolName = (data.toolName as string) ?? entry.toolName ?? "tool";
  const args = data.arguments as Record<string, unknown> | undefined;
  // Pick the best short summary from args
  const summary = (args?.intent ?? args?.description ?? args?.pattern ?? args?.path ?? args?.query ?? args?.command) as string | undefined;
  const shortSummary = summary
    ? summary.length > 100 ? summary.slice(0, 100) + "…" : summary
    : undefined;
  const isRunning = entry.toolStatus === "running";
  // Special display for report_intent
  const isReportIntent = toolName === "report_intent";
  if (isReportIntent) {
    const intent = args?.intent as string | undefined;
    return (
      <Box ml="sm" data-testid="inline-tool">
        <Group gap={4} wrap="nowrap">
          <Text size="xs" c="blue" fw={500}>🧠 {intent ?? "Thinking…"}</Text>
          {isRunning && <Loader size={10} type="dots" />}
        </Group>
      </Box>
    );
  }

  return (
    <Box ml="sm" data-testid="inline-tool">
      <Group
        gap={4}
        wrap="nowrap"
        style={{ cursor: args ? "pointer" : undefined }}
        onClick={() => args && setLocalExpanded((v) => !v)}
      >
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>🔧</Text>
        <Text size="xs" fw={500} truncate>{toolName}</Text>
        {shortSummary && <Text size="xs" c="dimmed" truncate>: {shortSummary}</Text>}
        {isRunning && <Loader size={10} type="dots" />}
        {args && <Text size="xs" c="dimmed">{showDetail ? "▲" : "▼"}</Text>}
      </Group>
      <Collapse in={showDetail}>
        <Code block style={{ fontSize: 11, maxHeight: 150, overflow: "auto", marginTop: 2, whiteSpace: "pre-wrap" }}>
          {JSON.stringify(args, null, 2)}
        </Code>
      </Collapse>
    </Box>
  );
});

/** ✅/❌ Tool completion — shows description, result content, click to expand */
const InlineToolComplete = memo(function InlineToolComplete({ entry, expanded: globalExpanded }: { entry: ConversationEntry; expanded?: boolean }) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const data = entry.eventData ?? {};
  const success = data.success !== false;
  const result = data.result as { content?: string; detailedContent?: string } | undefined;
  const resultContent = result?.content ?? entry.content ?? "";
  const detailedContent = result?.detailedContent ?? "";
  const origArgs = data.originalArguments as Record<string, unknown> | undefined;
  const toolArgs = data.arguments as Record<string, unknown> | undefined;
  const args = origArgs ?? toolArgs;
  const description = (args?.description ?? args?.intent) as string | undefined;
  const command = args?.command as string | undefined;
  const displayContent = globalExpanded ? (detailedContent || resultContent) : resultContent;
  const isTruncatable = !globalExpanded && displayContent.length > 120;
  const shown = isTruncatable && !localExpanded
    ? displayContent.slice(0, 120) + "…"
    : displayContent;
  const hasExpandable = isTruncatable || command;

  // Skip rendering report_intent completions
  if (resultContent === "Intent logged") return null;

  return (
    <Box ml="md" data-testid="inline-tool-result">
      {/* Tool description (always shown if available) */}
      {description && (
        <Text size="xs" c="dimmed" fw={500} mb={1}>{description}</Text>
      )}
      {/* Command (expandable) */}
      {command && (
        <Group gap={4} wrap="nowrap" mb={1}>
          <Code style={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {globalExpanded || localExpanded ? command : (command.length > 80 ? command.slice(0, 80) + "…" : command)}
          </Code>
        </Group>
      )}
      {/* Result */}
      <Group
        gap={4}
        wrap="nowrap"
        style={{ cursor: hasExpandable ? "pointer" : undefined }}
        onClick={() => hasExpandable && setLocalExpanded((v) => !v)}
      >
        <Text size="xs" c={success ? "green" : "red"} style={{ flexShrink: 0 }}>{success ? "✅" : "❌"}</Text>
        <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {shown}
        </Text>
        {hasExpandable && <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{localExpanded ? "▲" : "▼"}</Text>}
      </Group>
    </Box>
  );
});

/** 🤖 Subagent start/complete one-liner */
const InlineSubagent = memo(function InlineSubagent({ entry }: { entry: ConversationEntry }) {
  const data = entry.eventData ?? {};
  const et = entry.eventType ?? "";
  const name = (data.agentDisplayName as string) ?? (data.agentName as string) ?? "subagent";
  const isStart = et === "subagent.started";
  const isFail = et === "subagent.failed";
  const icon = isStart ? "🤖" : isFail ? "❌" : "✅";
  const label = isStart ? `Started: ${name}` : isFail ? `Failed: ${name}` : `Done: ${name}`;
  const error = data.error as string | undefined;

  return (
    <Box ml="sm" data-testid="inline-subagent">
      <Group gap={4} wrap="nowrap">
        <Text size="xs">{icon}</Text>
        <Text size="xs" fw={500}>{label}</Text>
      </Group>
      {error && <Text size="xs" c="red" ml="md">{error}</Text>}
    </Box>
  );
});

/** 💭 Reasoning — shows actual reasoning text, collapsible */
const InlineReasoning = memo(function InlineReasoning({ entry, expanded: globalExpanded }: { entry: ConversationEntry; expanded?: boolean }) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const showDetail = globalExpanded || localExpanded;
  const data = entry.eventData ?? {};
  const content = (data.content as string) ?? entry.content ?? "";
  // Skip if content looks like encrypted/opaque data (no spaces, very long base64-like)
  const isEncrypted = content.length > 50 && !content.includes(" ");

  if (isEncrypted && !showDetail) {
    return (
      <Text size="xs" c="dimmed" ml="sm" fs="italic" data-testid="inline-reasoning">
        💭 Reasoning (encrypted)
        {entry.isStreaming && <Loader size={10} type="dots" style={{ display: "inline", marginLeft: 4 }} />}
      </Text>
    );
  }

  const preview = content.length > 150 ? content.slice(0, 150) + "…" : content;

  return (
    <Box ml="sm" data-testid="inline-reasoning">
      <Group
        gap={4}
        wrap="nowrap"
        style={{ cursor: content.length > 150 ? "pointer" : undefined }}
        onClick={() => content.length > 150 && setLocalExpanded((v) => !v)}
      >
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>💭</Text>
        <Text size="xs" c="dimmed" fs="italic" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {showDetail ? content : preview}
        </Text>
        {entry.isStreaming && <Loader size={10} type="dots" />}
        {content.length > 150 && <Text size="xs" c="dimmed">{showDetail ? "▲" : "▼"}</Text>}
      </Group>
    </Box>
  );
});

/** Token usage badge — small inline display */
const InlineUsageInfo = memo(function InlineUsageInfo({ entry }: { entry: ConversationEntry }) {
  const data = entry.eventData ?? {};
  const current = data.currentTokens as number | undefined;
  const limit = data.tokenLimit as number | undefined;
  if (current == null) return null;
  return (
    <Text size="xs" c="dimmed" ml="sm" data-testid="inline-usage-info">
      🪙 {current.toLocaleString()}{limit ? ` / ${limit.toLocaleString()}` : ""}
    </Text>
  );
});

/** Generic event fallback — for events not in the hidden list but without a specific renderer */
const InlineGenericEvent = memo(function InlineGenericEvent({ entry }: { entry: ConversationEntry }) {
  const [expanded, setExpanded] = useState(false);
  const et = entry.eventType ?? "unknown";
  const hasData = entry.eventData && Object.keys(entry.eventData).length > 0;

  return (
    <Box ml="sm" data-testid="inline-generic-event">
      <Group
        gap={4}
        wrap="nowrap"
        style={{ cursor: hasData ? "pointer" : undefined }}
        onClick={() => hasData && setExpanded((v) => !v)}
      >
        <Badge size="xs" variant="light" color="gray">{et}</Badge>
        {entry.content && <Text size="xs" c="dimmed" truncate>{entry.content}</Text>}
        {hasData && <Text size="xs" c="dimmed">{expanded ? "▲" : "▼"}</Text>}
      </Group>
      {hasData && (
        <Collapse in={expanded}>
          <Code block style={{ fontSize: 11, maxHeight: 150, overflow: "auto", marginTop: 2, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(entry.eventData, null, 2)}
          </Code>
        </Collapse>
      )}
    </Box>
  );
});

// ── Message renderer ───────────────────────────────────

const ConversationMessage = memo(function ConversationMessage({
  entry,
  sessionId,
  expanded,
}: {
  entry: ConversationEntry;
  sessionId: string;
  expanded: boolean;
}) {
  // ── Event entries (SDK events) ──
  if (entry.type === "event") {
    const et = entry.eventType ?? "";

    // Hidden noise events
    if (HIDDEN_EVENT_TYPES.has(et)) return null;

    // Permission/input request cards (interactive)
    if (et === "copilot-permission-request" || et.includes("permission.request")) {
      return (
        <PermissionRequestCard
          sessionId={sessionId}
          requestId={entry.eventData?.requestId as string}
          toolName={entry.eventData?.toolName as string}
          toolArgs={(entry.eventData?.toolArgs as Record<string, unknown>) ?? {}}
        />
      );
    }
    if (et === "copilot-user-input-request" || et.includes("input.request")) {
      return (
        <UserInputRequestCard
          sessionId={sessionId}
          requestId={entry.eventData?.requestId as string}
          question={entry.eventData?.question as string}
          choices={entry.eventData?.choices as string[] | undefined}
        />
      );
    }

    // Smart inline renderers
    if (et === "assistant.turn_start") return <TurnDivider entry={entry} />;
    if (et === "assistant.usage") return null; // absorbed into assistant message annotation
    if (et === "session.usage_info") return null; // shown in controls bar
    if (et === "tool.execution_start") return <InlineToolStart entry={entry} expanded={expanded} />;
    if (et === "tool.execution_complete") return <InlineToolComplete entry={entry} expanded={expanded} />;
    if (et.startsWith("subagent.")) return <InlineSubagent entry={entry} />;
    if (et === "assistant.reasoning" || et === "assistant.reasoning_delta") return <InlineReasoning entry={entry} expanded={expanded} />;

    // Everything else: generic expandable
    return expanded ? <InlineGenericEvent entry={entry} /> : null;
  }

  // ── Tool entries from hooks ──
  if (entry.type === "tool") {
    if (entry.toolStatus === "running") {
      return <InlineToolStart entry={entry} expanded={expanded} />;
    }
    return <InlineToolComplete entry={entry} expanded={expanded} />;
  }

  // ── Standard entries ──
  switch (entry.type) {
    case "user":
      return <UserMessage entry={entry} expanded={expanded} />;
    case "assistant":
      return <AssistantMessage entry={entry} />;
    case "hq-tool":
      return <HqToolCard entry={entry} />;
    case "status":
      return <StatusDivider entry={entry} />;
    case "error":
      return <ErrorBanner entry={entry} />;
    default:
      return null;
  }
});

// ── SDK Control Panel ──────────────────────────────────

const MODE_OPTIONS: Array<{ value: CopilotSessionMode; label: string }> = [
  { value: "interactive", label: "Interactive" },
  { value: "plan", label: "Plan" },
  { value: "autopilot", label: "Autopilot" },
];
const DEFAULT_SESSION_AGENT_ID = "builtin:default";
const DEFAULT_SESSION_AGENT_LABEL = "Default";

function SdkControlPanel({ sessionId }: { sessionId: string }) {
  const { data: session } = useAggregatedSession(sessionId);
  const { data: modelsData } = useListModels();
  const { data: planData } = useGetPlan(sessionId);
  const setModel = useSetModel();
  const setMode = useSetMode();
  const deletePlan = useDeletePlan();

  const [planExpanded, setPlanExpanded] = useState(false);

  const modelOptions = (modelsData?.models ?? []).map((m) => ({
    value: m.id,
    label: m.name,
  }));

  return (
    <Stack gap="xs" p="xs">
      {/* Model selector */}
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <Select
          label="Model"
          size="xs"
          data={modelOptions}
          value={session?.model ?? null}
          onChange={(val) => {
            if (val) setModel.mutate({ sessionId, model: val });
          }}
          placeholder="Select model"
          style={{ flex: 1 }}
          disabled={setModel.isPending}
          allowDeselect={false}
        />
      </Group>

      {/* Mode control */}
      <Stack gap={4}>
        <Text size="xs" fw={500}>
          Mode
        </Text>
        <Group gap={4}>
          {MODE_OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              size="compact-xs"
              variant={session?.mode === value ? "filled" : "light"}
              onClick={() => setMode.mutate({ sessionId, mode: value })}
              disabled={setMode.isPending}
            >
              {label}
            </Button>
          ))}
        </Group>
      </Stack>

      {/* Plan viewer */}
      <Stack gap={4}>
        <Group gap="xs" justify="space-between">
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => setPlanExpanded((p) => !p)}
          >
            📋 Plan {planExpanded ? "▾" : "▸"}
          </Button>
          {planData?.content && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              onClick={() => deletePlan.mutate(sessionId)}
              loading={deletePlan.isPending}
            >
              Delete Plan
            </Button>
          )}
        </Group>
        <Collapse in={planExpanded}>
          <Paper withBorder p="xs" radius="sm">
            <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
              {planData?.content || "No plan set"}
            </Text>
          </Paper>
        </Collapse>
      </Stack>

    </Stack>
  );
}
// ── Main Component ─────────────────────────────────────

export function CopilotConversation({
  sessionId,
  sessionType: _sessionType,
  controlPanelOpen,
}: CopilotConversationProps) {
  const { selectedProject } = useSelectedProject();
  const owner = selectedProject?.owner;
  const repo = selectedProject?.repo;
  const { entries, rawEvents, isLoading, isError, error, sessionStatus } =
    useConversationEntries(sessionId);
  const { data: sessionData } = useAggregatedSession(sessionId);
  const activity = sessionData?.activity ?? DEFAULT_SESSION_ACTIVITY;

  const sendPrompt = useSendPrompt();
  const abortSession = useAbortSession();
  const { data: modelsData } = useListModels();
  const setModel = useSetModel();
  const { data: agentCatalogData, isLoading: isAgentCatalogLoading } = useCopilotAgentCatalog(
    owner,
    repo,
  );
  const { data: currentAgent, isLoading: isCurrentAgentLoading } = useGetSessionAgent(sessionId);
  const setSessionAgent = useSetSessionAgent();

  const [promptText, setPromptText] = useState("");
  const [showRawEvents, setShowRawEvents] = useState(false);
  const [expandedView, setExpandedView] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");

  // Auto-scroll logic
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const prevEntriesLenRef = useRef(0);

  const handleScroll = useCallback(
    ({ y }: { x: number; y: number }) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const atBottom =
        viewport.scrollHeight - viewport.clientHeight - y < 40;
      userScrolledUpRef.current = !atBottom;
    },
    [],
  );

  const isProcessing = sessionStatus === "active";

  // All entries shown inline — noise is filtered by HIDDEN_EVENT_TYPES in the renderer
  const conversationEntries = entries;

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (conversationEntries.length > prevEntriesLenRef.current && !userScrolledUpRef.current) {
      const viewport = viewportRef.current;
      if (viewport && typeof viewport.scrollTo === "function") {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      }
    }
    prevEntriesLenRef.current = conversationEntries.length;
  }, [conversationEntries.length]);

  const currentAgentId = currentAgent?.agentId ?? DEFAULT_SESSION_AGENT_ID;
  const agentOptions = useMemo(() => {
    const options = new Map<string, string>([
      [DEFAULT_SESSION_AGENT_ID, DEFAULT_SESSION_AGENT_LABEL],
    ]);

    for (const agent of agentCatalogData?.agents ?? []) {
      const label =
        agent.id === DEFAULT_SESSION_AGENT_ID
          ? DEFAULT_SESSION_AGENT_LABEL
          : agent.displayName ?? agent.name;
      options.set(agent.id, label);
    }

    if (currentAgentId !== DEFAULT_SESSION_AGENT_ID && !options.has(currentAgentId)) {
      options.set(currentAgentId, currentAgent?.agentName ?? currentAgentId);
    }

    return Array.from(options, ([value, label]) => ({ value, label }));
  }, [agentCatalogData?.agents, currentAgent?.agentName, currentAgentId]);
  const isAgentSelectorDisabled =
    !selectedProject ||
    isAgentCatalogLoading ||
    isCurrentAgentLoading ||
    setSessionAgent.isPending;

  const modelOptions = useMemo(() => {
    return (modelsData?.models ?? []).map((m) => ({
      value: m.id,
      label: m.name,
    }));
  }, [modelsData?.models]);

  const currentModelId = sessionData?.model ?? "";

  const handleModelChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextModel = event.currentTarget.value;
      if (nextModel && nextModel !== currentModelId) {
        setModel.mutate({ sessionId, model: nextModel });
      }
    },
    [sessionId, currentModelId, setModel],
  );

  const handleSend = useCallback((mode?: PromptDeliveryMode) => {
    const text = promptText.trim();
    if (!text || sendPrompt.isPending) return;
    sendPrompt.mutate({ sessionId, prompt: text, ...(mode ? { mode } : {}) });
    setPromptText("");
  }, [promptText, sessionId, sendPrompt]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleAbort = useCallback(() => {
    abortSession.mutate(sessionId);
  }, [sessionId, abortSession]);

  const handleAgentChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextAgentId = event.currentTarget.value;
      if (!nextAgentId || nextAgentId === currentAgentId) {
        return;
      }
      setSessionAgent.mutate({
        sessionId,
        agentId: nextAgentId === DEFAULT_SESSION_AGENT_ID ? null : nextAgentId,
      });
    },
    [currentAgentId, sessionId, setSessionAgent],
  );

  // ── Render ─────────────────────────────────────────

  return (
    <Stack gap={0} style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* SDK Control Panel */}
      <Collapse in={!!controlPanelOpen}>
        <Box style={{ borderBottom: "1px solid var(--lp-border)" }}>
          <SdkControlPanel sessionId={sessionId} />
        </Box>
      </Collapse>

      {/* View controls bar */}
      <Group px="xs" py={2} justify="flex-end" gap={4}
        style={{ borderBottom: "1px solid var(--lp-border)" }}
      >
        <Button
          size="compact-xs"
          variant={expandedView ? "filled" : "subtle"}
          color={expandedView ? "blue" : undefined}
          onClick={() => setExpandedView((v) => !v)}
          data-testid="expanded-view-toggle"
        >
          {expandedView ? "◉ Expanded" : "○ Simple"}
        </Button>
        <Button
          size="compact-xs"
          variant={showRawEvents ? "filled" : "subtle"}
          color={showRawEvents ? "gray" : undefined}
          onClick={() => setShowRawEvents((v) => !v)}
          data-testid="raw-events-toggle"
        >
          {showRawEvents ? "← Conversation" : `📋 Raw Events${rawEvents.length ? ` (${rawEvents.length})` : ""}`}
        </Button>
      </Group>

      {/* Message area OR Raw events panel */}
      {showRawEvents ? (
        <ScrollArea style={{ flex: 1 }} p="xs" data-testid="raw-events-panel">
          {rawEvents.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" p="md">
              No events captured yet. Events appear as the agent works.
            </Text>
          ) : (
            <Stack gap={4}>
              {rawEvents.map((evt, i) => (
                <Paper
                  key={`${evt.timestamp}-${i}`}
                  withBorder
                  p="xs"
                  radius="sm"
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                >
                  <Group gap={6} mb={4} wrap="nowrap">
                    <Badge size="xs" variant="light" color={
                      evt.type.startsWith("assistant.") ? "grape" :
                      evt.type.startsWith("tool.") ? "orange" :
                      evt.type.startsWith("session.") ? "blue" :
                      evt.type.startsWith("subagent.") ? "violet" :
                      evt.type.startsWith("user") ? "teal" :
                      "gray"
                    }>
                      {evt.type}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {new Date(evt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)}
                    </Text>
                  </Group>
                  <Code block style={{ fontSize: 11, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(evt.data, null, 2)}
                  </Code>
                </Paper>
              ))}
            </Stack>
          )}
        </ScrollArea>
      ) : (
        <ScrollArea
          ref={scrollAreaRef}
          viewportRef={viewportRef}
          onScrollPositionChange={handleScroll}
          style={{ flex: 1 }}
          p="xs"
        >
        {isLoading && (
          <Stack align="center" p="md">
            <Loader size="sm" />
          </Stack>
        )}

        {isError && (
          <Text size="sm" c="red" p="xs">
            Failed to load messages: {error?.message ?? "Unknown error"}
          </Text>
        )}

        {!isLoading && !isError && conversationEntries.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" p="md" data-testid="empty-state">
            No messages yet
          </Text>
        )}

        <Stack gap="sm">
          {conversationEntries.map((entry) => (
            <ConversationMessage key={entry.id} entry={entry} sessionId={sessionId} expanded={expandedView} />
          ))}
        </Stack>
        </ScrollArea>
      )}

      {/* Activity status label — above the prompt divider */}
      {activity.phase !== "idle" && !activity.waitingState && (
        <Group gap={6} px="xs" py={4} data-testid="thinking-label">
          <Loader size={12} type="dots" />
          <Text size="xs" c="dimmed">
            {activity.phase === "thinking" && (activity.intent ? `Thinking — ${activity.intent}` : "Thinking…")}
            {activity.phase === "tool" && (activity.activeToolCalls[0]
              ? `Running ${activity.activeToolCalls[0].name}…`
              : "Running tool…")}
            {activity.phase === "subagent" && (activity.activeSubagents[0]
              ? `${activity.activeSubagents[0].displayName ?? activity.activeSubagents[0].name} working…`
              : "Sub-agent working…")}
            {activity.phase === "error" && "Error"}
          </Text>
        </Group>
      )}

      {/* Prompt input */}
      <Box
        p="xs"
        style={{
          borderTop: activity.waitingState
            ? "2px solid var(--mantine-color-yellow-6)"
            : "1px solid var(--lp-border)",
          ...(activity.waitingState ? {
            backgroundColor: "var(--mantine-color-yellow-light)",
          } : {}),
        }}
        data-testid="prompt-area"
      >
        {/* Waiting state question banner */}
        {activity.waitingState && (
          <Box mb="xs" data-testid="waiting-banner">
            <Group gap={6} mb={4}>
              <Badge size="xs" color="yellow" variant="filled">
                {activity.waitingState.type === "user-input" ? "❓ Agent Question" :
                 activity.waitingState.type === "elicitation" ? "📋 Input Needed" :
                 activity.waitingState.type === "plan-exit" ? "📝 Plan Exit" :
                 "🔐 Permission"}
              </Badge>
            </Group>
            {activity.waitingState.question && (
              <Text size="sm" fw={500} mb={activity.waitingState.choices?.length ? 4 : 0}>
                {activity.waitingState.question}
              </Text>
            )}
            {activity.waitingState.choices && activity.waitingState.choices.length > 0 && (
              <Group gap={4} wrap="wrap">
                {activity.waitingState.choices.map((choice) => (
                  <Button
                    key={choice}
                    size="xs"
                    variant="light"
                    onClick={() => {
                      sendPrompt.mutate({ sessionId, prompt: choice });
                    }}
                    data-testid="waiting-choice"
                  >
                    {choice}
                  </Button>
                ))}
              </Group>
            )}
          </Box>
        )}
        <Stack gap="xs">
          <Group gap="xs" wrap="nowrap">
            <NativeSelect
              aria-label="Session agent"
              data-testid="session-agent-select"
              data={agentOptions}
              value={currentAgentId}
              onChange={handleAgentChange}
              disabled={isAgentSelectorDisabled}
              size="sm"
              style={{ width: isMobile ? undefined : 150, flex: isMobile ? 1 : undefined, flexShrink: 0 }}
            />
            {modelOptions.length > 0 && (
              <NativeSelect
                aria-label="Model"
                data-testid="session-model-select"
                data={modelOptions}
                value={currentModelId}
                onChange={handleModelChange}
                disabled={setModel.isPending}
                size="sm"
                style={{ width: isMobile ? undefined : 180, flex: isMobile ? 1 : undefined, flexShrink: 0 }}
              />
            )}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <TextInput
              placeholder={
                isProcessing
                  ? "Steer the current work or queue a follow-up…"
                  : "Type a prompt…"
              }
              value={promptText}
              onChange={(e) => setPromptText(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              disabled={sendPrompt.isPending}
              style={{ flex: 1 }}
              size="sm"
              data-testid="prompt-input"
            />
            {isProcessing ? (
              <>
                <Button
                  size="sm"
                  variant="light"
                  onClick={() => handleSend("immediate")}
                  loading={sendPrompt.isPending}
                  disabled={!promptText.trim()}
                  data-testid="steer-button"
                >
                  Steer
                </Button>
                <Button
                  size="sm"
                  variant="light"
                  onClick={() => handleSend("enqueue")}
                  loading={sendPrompt.isPending}
                  disabled={!promptText.trim()}
                  data-testid="queue-button"
                >
                  Queue
                </Button>
                <Button
                  size="sm"
                  color="red"
                  variant="light"
                  onClick={handleAbort}
                  loading={abortSession.isPending}
                  data-testid="abort-button"
                >
                  Abort
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={() => handleSend()}
                loading={sendPrompt.isPending}
                disabled={!promptText.trim()}
                data-testid="send-button"
              >
                Send
              </Button>
            )}
          </Group>
        </Stack>
      </Box>
    </Stack>
  );
}
