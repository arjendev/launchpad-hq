import { memo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  Collapse,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { ConversationEntry } from "../services/types.js";
import { authFetch } from "../services/authFetch.js";
import { MarkdownContent } from "./MarkdownContent.js";

// ── Individual message components (memoized) ───────────

export const UserMessage = memo(function UserMessage({ entry }: { entry: ConversationEntry }) {
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
      </Paper>
    </Group>
  );
});

export const AssistantMessage = memo(function AssistantMessage({
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
  const subagentName = data.subagentName as string | undefined;
  const mainAgentName = data.agentName as string | undefined;
  const initiator = data.initiator as string | undefined;
  const agentLabel = isSubagentMessage
    ? (subagentName ?? "Sub-agent")
    : (mainAgentName ?? (initiator === "agent" ? "Agent" : undefined));

  const metaParts: string[] = [];
  if (agentLabel) metaParts.push(agentLabel);
  if (model) metaParts.push(model);
  if (duration != null) metaParts.push(`${(duration / 1000).toFixed(1)}s`);

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
        {metaParts.length > 0 && (
          <Text size="xs" c="dimmed" mb={2}>
            {metaParts.join(" · ")}
          </Text>
        )}
        {entry.content.trim() && (
          <MarkdownContent content={entry.content} />
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
      </Paper>
    </Group>
  );
});

export const HqToolCard = memo(function HqToolCard({ entry }: { entry: ConversationEntry }) {
  const name = entry.hqToolName ?? "tool";
  const isBlocker = name === "report_blocker";
  const isReview = name === "request_human_review";
  const label = isBlocker ? "Blocked" : isReview ? "Review requested" : "Progress";

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
        withBorder
        style={{
          maxWidth: "80%",
          borderColor: isBlocker
            ? "var(--mantine-color-red-4)"
            : isReview
              ? "var(--mantine-color-blue-4)"
              : "var(--mantine-color-gray-4)",
          ...(isBlocker ? { backgroundColor: "var(--mantine-color-red-0)" } : {}),
        }}
      >
        <Text size="sm" fw={600}>
          {label}
        </Text>
        {summary && (
          <Text size="xs" mt={2} style={{ whiteSpace: "pre-wrap" }}>
            {summary}
          </Text>
        )}
      </Paper>
    </Group>
  );
});

export const ErrorBanner = memo(function ErrorBanner({
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
        ▲ {entry.content}
      </Text>
    </Paper>
  );
});

// ── Multi-agent awareness components ───────────────────

export const PermissionRequestCard = memo(function PermissionRequestCard({
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
    await authFetch(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/permission-response`, {
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
          <Badge size="xs" color="yellow" variant="light">Permission</Badge>
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
              Allow
            </Button>
            <Button size="xs" color="red" variant="light" onClick={() => handleDecision("deny")}>
              Deny
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

export const UserInputRequestCard = memo(function UserInputRequestCard({
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
    await authFetch(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/user-input-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, answer: selectedAnswer, wasFreeform }),
    });
    setAnswered(true);
  };

  return (
    <Paper withBorder p="xs" radius="sm" style={{ borderColor: "var(--mantine-color-blue-4)", borderStyle: "dashed" }}>
      <Stack gap={4}>
        <Text size="sm" fw={500}>?  {question}</Text>
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

export const HIDDEN_EVENT_TYPES = new Set([
  "session.tools_updated",
  "hook.start",
  "hook.end",
  "permission.completed",
  "session.background_tasks_changed",
  "subagent.selected",
  "subagent.started",
  "subagent.completed",
  "subagent.failed",
  "subagent.deselected",
  "assistant.turn_end",
  "assistant.usage",
  "session.idle",
  "session.start",
  "session.resume",
  "session.model_change",
  "session.mode_changed",
  "session.plan_changed",
  "session.updated",
  "session.context_changed",
  "session.usage_info",
  "pending_messages.modified",
]);

// ── New component system ───────────────────────────────

/** Thin turn divider — only shown for turn > 0 */
export const TurnDivider = memo(function TurnDivider({ entry }: { entry: ConversationEntry }) {
  const turnId = entry.eventData?.turnId as number | string | undefined;
  // Skip the first turn — it's obvious
  if (turnId === 0 || turnId === "0") return null;
  const label = turnId != null ? `Turn ${turnId}` : "New turn";
  return (
    <Divider
      label={<Text size="xs" c="dimmed">{label}</Text>}
      labelPosition="center"
      color="dimmed"
      my={2}
      data-testid="turn-divider"
    />
  );
});

/** Floating intent label — shows above tool call groups */
export const IntentLabel = memo(function IntentLabel({ entry }: { entry: ConversationEntry }) {
  const intent = entry.content || (entry.eventData?.arguments as Record<string, unknown>)?.intent as string | undefined;
  if (!intent) return null;
  return (
    <Text size="xs" c="dimmed" fs="italic" ml="sm" mt={4} mb={2} data-testid="intent-label">
      {intent}
    </Text>
  );
});

/** Unified tool call card — merges execution_start + execution_complete lifecycle */
export const ToolCallCard = memo(function ToolCallCard({ entry, expanded: globalExpanded }: { entry: ConversationEntry; expanded?: boolean }) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const showDetail = globalExpanded || localExpanded;

  const isRunning = entry.toolStatus === "running";
  const isFailed = entry.toolStatus === "failed";
  const isDone = entry.toolStatus === "completed";

  const tag = entry.toolTag ?? "tool";
  const description = entry.toolDescription ?? entry.toolName ?? "tool";
  const detail = entry.toolDetail;
  const result = entry.toolResult ?? entry.content;

  // Truncate detail line
  const shortDetail = detail
    ? detail.length > 80 ? detail.slice(0, 80) + "…" : detail
    : undefined;

  // Status indicator
  const indicator = isRunning ? "◌" : "●";
  const indicatorColor = isFailed ? "red" : isDone ? "green" : "dimmed";

  // Auto-expand failed tool calls
  const isExpanded = showDetail || (isFailed && !!result);

  return (
    <Paper
      ml="sm"
      p={6}
      radius="sm"
      data-testid="tool-call-card"
      withBorder={isDone || isFailed}
      style={{
        cursor: "pointer",
        ...(isRunning ? {
          borderStyle: "dashed",
          borderWidth: 1,
          borderColor: "var(--mantine-color-gray-4)",
          opacity: 0.9,
        } : {}),
        ...(isFailed ? {
          borderLeftColor: "var(--mantine-color-red-4)",
          borderLeftWidth: 3,
        } : {}),
      }}
      onClick={() => setLocalExpanded((v) => !v)}
    >
      {/* Header: indicator + description + tag */}
      <Group gap={6} wrap="nowrap">
        <Text
          size="xs"
          c={indicatorColor}
          fw={700}
          style={{
            flexShrink: 0,
            ...(isRunning ? {
              animation: "pulse 1.5s ease-in-out infinite",
            } : {}),
          }}
        >
          {indicator}
        </Text>
        <Text size="sm" fw={500} truncate style={{ flex: 1 }}>
          {description}
        </Text>
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          ({tag})
        </Text>
        {isFailed && (
          <Badge size="xs" color="red" variant="light">failed</Badge>
        )}
        {(isDone || isFailed) && (
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {localExpanded ? "▾" : "▸"}
          </Text>
        )}
      </Group>

      {/* Detail line — dimmed italic */}
      {shortDetail && description !== detail && (
        <Text size="xs" c="dimmed" fs="italic" ml={18} truncate>
          {showDetail ? detail : shortDetail}
        </Text>
      )}

      {/* Expanded: full result */}
      <Collapse in={isExpanded}>
        {result && result !== entry.toolName && (
          <Code
            block
            style={{
              fontSize: 11,
              maxHeight: 200,
              overflow: "auto",
              marginTop: 4,
              marginLeft: 18,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {result}
          </Code>
        )}
      </Collapse>
    </Paper>
  );
});

/** Subagent container — collapsible container with inner event rendering + kill button */
export const SubagentContainer = memo(function SubagentContainer({
  entry,
  sessionId,
  expanded: globalExpanded,
}: {
  entry: ConversationEntry;
  sessionId: string;
  expanded?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [killing, setKilling] = useState(false);

  const status = entry.subagentStatus ?? "running";
  const isRunning = status === "running";
  const isFailed = status === "failed" || status === "killed";
  const isDone = status === "done";
  const description = entry.toolDescription ?? "Agent task";
  const model = entry.subagentModel;
  const duration = entry.subagentDuration;
  const innerEntries = entry.subagentEntries ?? [];
  const error = entry.eventData?.error as string | undefined;

  const indicator = isRunning ? "◌" : "●";
  const indicatorColor = isFailed ? "red" : isDone ? "green" : "dimmed";

  // Collapse when done (default)
  const showInner = isRunning || isOpen;

  const handleKill = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setKilling(true);
    try {
      await authFetch(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId: entry.toolCallId }),
      });
    } catch {
      // best-effort
    }
    setKilling(false);
  };

  return (
    <Paper
      ml="sm"
      p={8}
      radius="sm"
      data-testid="subagent-container"
      style={{
        cursor: "pointer",
        ...(isRunning ? {
          borderStyle: "dashed",
          borderWidth: 1,
          borderColor: "var(--mantine-color-violet-4)",
        } : {
          border: "1px solid var(--mantine-color-gray-4)",
        }),
        ...(isFailed ? {
          borderLeftColor: "var(--mantine-color-red-4)",
          borderLeftWidth: 3,
        } : {}),
      }}
      onClick={() => setIsOpen((v) => !v)}
    >
      {/* Header */}
      <Group gap={6} wrap="nowrap">
        <Text
          size="xs"
          c={indicatorColor}
          fw={700}
          style={{
            flexShrink: 0,
            ...(isRunning ? { animation: "pulse 1.5s ease-in-out infinite" } : {}),
          }}
        >
          {indicator}
        </Text>
        <Text size="sm" fw={500} truncate style={{ flex: 1 }}>
          {description}
        </Text>
        {model && (
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {model}
          </Text>
        )}
        {isDone && duration != null && (
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {(duration / 1000).toFixed(1)}s
          </Text>
        )}
        {isFailed && (
          <Badge size="xs" color="red" variant="light">
            {status === "killed" ? "killed" : "failed"}
          </Badge>
        )}
        {isRunning && (
          <ActionIcon
            size="xs"
            variant="subtle"
            color="red"
            onClick={handleKill}
            loading={killing}
            title="Kill subagent"
          >
            <Text size="xs">✕</Text>
          </ActionIcon>
        )}
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {showInner ? "▾" : "▸"}
        </Text>
      </Group>

      {/* Inner entries */}
      <Collapse in={showInner}>
        {innerEntries.length > 0 && (
          <Stack gap={4} mt={6} ml={12}>
            {innerEntries.map((inner) => (
              <ConversationMessage
                key={inner.id}
                entry={inner}
                sessionId={sessionId}
                expanded={globalExpanded ?? false}
              />
            ))}
          </Stack>
        )}
        {error && (
          <Text size="xs" c="red" mt={4} ml={18}>
            {error}
          </Text>
        )}
      </Collapse>

      {/* Collapsed summary for completed agents */}
      {!showInner && innerEntries.length > 0 && (
        <Text size="xs" c="dimmed" ml={18} mt={2}>
          {innerEntries.filter((e) => e.type === "tool").length} tool calls
        </Text>
      )}
    </Paper>
  );
});

/** Reasoning — collapsible, no emoji */
export const InlineReasoning = memo(function InlineReasoning({ entry, expanded: globalExpanded }: { entry: ConversationEntry; expanded?: boolean }) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const showDetail = globalExpanded || localExpanded;
  const data = entry.eventData ?? {};
  const content = (data.content as string) ?? entry.content ?? "";
  // Skip if content looks like encrypted/opaque data (no spaces, very long base64-like)
  const isEncrypted = content.length > 50 && !content.includes(" ");

  if (isEncrypted) {
    return (
      <Text size="xs" c="dimmed" ml="sm" fs="italic" data-testid="inline-reasoning">
        Reasoning (redacted)
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
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {showDetail ? "▾" : "▸"}
        </Text>
        <Text size="xs" c="dimmed" fs="italic" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {showDetail ? content : preview}
        </Text>
        {entry.isStreaming && <Loader size={10} type="dots" />}
      </Group>
    </Box>
  );
});

/** Generic event fallback — for events not in the hidden list but without a specific renderer */
export const InlineGenericEvent = memo(function InlineGenericEvent({ entry }: { entry: ConversationEntry }) {
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
        {hasData && <Text size="xs" c="dimmed">{expanded ? "▾" : "▸"}</Text>}
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

// ── CSS for pulse animation (injected once) ────────────
if (typeof document !== "undefined") {
  const styleId = "lp-tool-pulse";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`;
    document.head.appendChild(style);
  }
}

// ── ConversationMessage dispatcher ─────────────────────

export const ConversationMessage = memo(function ConversationMessage({
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
    if (et === "report_intent") return <IntentLabel entry={entry} />;
    if (et === "assistant.reasoning" || et === "assistant.reasoning_delta") return <InlineReasoning entry={entry} expanded={expanded} />;

    // Everything else: generic expandable
    return expanded ? <InlineGenericEvent entry={entry} /> : null;
  }

  // ── Tool entries ──
  if (entry.type === "tool") {
    // Subagent containers (task tool with subagent lifecycle)
    if (entry.toolTag === "agent" && entry.subagentEntries != null) {
      return <SubagentContainer entry={entry} sessionId={sessionId} expanded={expanded} />;
    }
    return <ToolCallCard entry={entry} expanded={expanded} />;
  }

  // ── Standard entries ──
  switch (entry.type) {
    case "user":
      return <UserMessage entry={entry} />;
    case "assistant":
      return <AssistantMessage entry={entry} />;
    case "hq-tool":
      return <HqToolCard entry={entry} />;
    case "status":
      return null; // session.idle removed
    case "error":
      return <ErrorBanner entry={entry} />;
    default:
      return null;
  }
});
