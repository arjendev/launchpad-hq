import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Collapse,
  Divider,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  useAggregatedSession,
  useConversationEntries,
  useSendPrompt,
  useAbortSession,
  useListModels,
  useSetModel,
  useSetMode,
  useGetPlan,
  useDeletePlan,
  useDisconnectSession,
} from "../services/hooks.js";
import type { ConversationEntry } from "../services/types.js";

// ── Props ──────────────────────────────────────────────

export interface CopilotConversationProps {
  sessionId: string;
  onClose?: () => void;
}

// ── Status helpers ─────────────────────────────────────

const statusColor: Record<string, string> = {
  active: "green",
  idle: "yellow",
  error: "red",
  ended: "gray",
};

const statusLabel: Record<string, string> = {
  active: "● active",
  idle: "● idle",
  error: "● error",
  ended: "● ended",
};

// ── Individual message components (memoized) ───────────

const UserMessage = memo(function UserMessage({ entry }: { entry: ConversationEntry }) {
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

const AssistantMessage = memo(function AssistantMessage({
  entry,
}: {
  entry: ConversationEntry;
}) {
  return (
    <Group justify="flex-start" data-testid="assistant-message">
      <Paper
        p="xs"
        radius="md"
        withBorder
        style={{ maxWidth: "80%" }}
      >
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {entry.content}
        </Text>
        {entry.isStreaming && (
          <Group gap={4} mt={4}>
            <Loader size={12} type="dots" />
            <Text size="xs" c="dimmed">
              typing…
            </Text>
          </Group>
        )}
      </Paper>
    </Group>
  );
});

const ToolCard = memo(function ToolCard({ entry }: { entry: ConversationEntry }) {
  const statusIcon =
    entry.toolStatus === "running"
      ? "⏳"
      : entry.toolStatus === "completed"
        ? "✓"
        : "✗";
  const statusClr =
    entry.toolStatus === "running"
      ? "blue"
      : entry.toolStatus === "completed"
        ? "green"
        : "red";

  return (
    <Group justify="flex-start" data-testid="tool-card">
      <Paper
        p="xs"
        radius="sm"
        withBorder
        style={{
          maxWidth: "80%",
          opacity: 0.85,
          borderStyle: "dashed",
        }}
      >
        <Group gap="xs" wrap="nowrap">
          <Text size="sm">🔧</Text>
          <Text size="sm" fw={500}>
            {entry.toolName}
          </Text>
          <Badge size="xs" color={statusClr} variant="light">
            {statusIcon} {entry.toolStatus}
          </Badge>
        </Group>
        {entry.content && (
          <Text size="xs" c="dimmed" lineClamp={3} mt={2}>
            {entry.content}
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

// ── Message renderer ───────────────────────────────────

const ConversationMessage = memo(function ConversationMessage({
  entry,
}: {
  entry: ConversationEntry;
}) {
  switch (entry.type) {
    case "user":
      return <UserMessage entry={entry} />;
    case "assistant":
      return <AssistantMessage entry={entry} />;
    case "tool":
      return <ToolCard entry={entry} />;
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

const AVAILABLE_MODES = ["agent", "edit", "ask"];

function SdkControlPanel({ sessionId }: { sessionId: string }) {
  const { data: session } = useAggregatedSession(sessionId);
  const { data: modelsData } = useListModels();
  const { data: planData } = useGetPlan(sessionId);
  const setModel = useSetModel();
  const setMode = useSetMode();
  const deletePlan = useDeletePlan();
  const disconnectSession = useDisconnectSession();

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
          {AVAILABLE_MODES.map((m) => (
            <Button
              key={m}
              size="compact-xs"
              variant={session?.mode === m ? "filled" : "light"}
              onClick={() => setMode.mutate({ sessionId, mode: m })}
              disabled={setMode.isPending}
            >
              {m}
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

      {/* Disconnect */}
      <Button
        size="compact-xs"
        variant="light"
        color="orange"
        onClick={() => disconnectSession.mutate(sessionId)}
        loading={disconnectSession.isPending}
        fullWidth
      >
        ⛓️‍💥 Disconnect
      </Button>
    </Stack>
  );
}

// ── Main Component ─────────────────────────────────────

export function CopilotConversation({
  sessionId,
  onClose,
}: CopilotConversationProps) {
  const { data: session } = useAggregatedSession(sessionId);
  const { entries, isLoading, isError, error, sessionStatus } =
    useConversationEntries(sessionId);

  const sendPrompt = useSendPrompt();
  const abortSession = useAbortSession();

  const [promptText, setPromptText] = useState("");
  const [controlPanelOpen, setControlPanelOpen] = useState(false);

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

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (entries.length > prevEntriesLenRef.current && !userScrolledUpRef.current) {
      const viewport = viewportRef.current;
      if (viewport && typeof viewport.scrollTo === "function") {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      }
    }
    prevEntriesLenRef.current = entries.length;
  }, [entries.length]);

  const isProcessing = sessionStatus === "active";

  const handleSend = useCallback(() => {
    const text = promptText.trim();
    if (!text || sendPrompt.isPending) return;
    sendPrompt.mutate({ sessionId, prompt: text });
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

  const handleEndSession = useCallback(() => {
    abortSession.mutate(sessionId, { onSuccess: () => onClose?.() });
  }, [sessionId, abortSession, onClose]);

  // ── Render ─────────────────────────────────────────

  return (
    <Stack gap={0} style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Box p="xs" style={{ borderBottom: "1px solid var(--lp-border)" }}>
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            {onClose && (
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={onClose}
                data-testid="back-button"
              >
                ← Back
              </Button>
            )}
            <Text size="sm" fw={600} truncate>
              {session?.title ?? `Session ${sessionId.slice(0, 8)}`}
            </Text>
          </Group>
          <Group gap={4} wrap="nowrap">
            <Badge
              size="xs"
              variant="dot"
              color={statusColor[sessionStatus ?? "idle"] ?? "gray"}
            >
              {statusLabel[sessionStatus ?? "idle"] ?? sessionStatus}
            </Badge>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setControlPanelOpen((o) => !o)}
              data-testid="control-panel-toggle"
            >
              ⚙️
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              onClick={handleEndSession}
              loading={abortSession.isPending}
              data-testid="end-session-button"
            >
              ✕ End
            </Button>
          </Group>
        </Group>
      </Box>

      {/* SDK Control Panel */}
      <Collapse in={controlPanelOpen}>
        <Box style={{ borderBottom: "1px solid var(--lp-border)" }}>
          <SdkControlPanel sessionId={sessionId} />
        </Box>
      </Collapse>

      {/* Message area */}
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

        {!isLoading && !isError && entries.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" p="md" data-testid="empty-state">
            No messages yet
          </Text>
        )}

        <Stack gap="sm">
          {entries.map((entry) => (
            <ConversationMessage key={entry.id} entry={entry} />
          ))}
        </Stack>
      </ScrollArea>

      {/* Prompt input */}
      <Box
        p="xs"
        style={{ borderTop: "1px solid var(--lp-border)" }}
        data-testid="prompt-area"
      >
        <Group gap="xs" wrap="nowrap">
          <TextInput
            placeholder={isProcessing ? "Session processing…" : "Type a prompt…"}
            value={promptText}
            onChange={(e) => setPromptText(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing || sendPrompt.isPending}
            style={{ flex: 1 }}
            size="sm"
            data-testid="prompt-input"
          />
          {isProcessing ? (
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
          ) : (
            <Button
              size="sm"
              onClick={handleSend}
              loading={sendPrompt.isPending}
              disabled={!promptText.trim()}
              data-testid="send-button"
            >
              Send
            </Button>
          )}
        </Group>
      </Box>
    </Stack>
  );
}
