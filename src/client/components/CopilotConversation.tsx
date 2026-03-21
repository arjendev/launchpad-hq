import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Code,
  Collapse,
  Group,
  Loader,
  NativeSelect,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
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
} from "../services/hooks.js";
import type { SteeringMessage } from "../services/hooks.js";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import type {
  PromptDeliveryMode,
} from "../services/types.js";
import { DEFAULT_SESSION_ACTIVITY } from "../services/types.js";
import { ConversationMessage } from "./ConversationMessageRenderers.js";
import { SdkControlPanel } from "./SdkControlPanel.js";

// ── Props ──────────────────────────────────────────────

export interface CopilotConversationProps {
  sessionId: string;
  sessionType?: string;
  controlPanelOpen?: boolean;
  /** Called when the user changes the agent in the dropdown. */
  onAgentChange?: (agentId: string | null) => void;
}

const DEFAULT_SESSION_AGENT_ID = "builtin:default";
const DEFAULT_SESSION_AGENT_LABEL = "Default";

function truncateMessage(msg: string, maxLen = 80): string {
  return msg.length > maxLen ? msg.slice(0, maxLen) + "…" : msg;
}

/** Compact status bar for a queued/pending user prompt */
function QueuedMessageBar({ message }: { message: string }) {
  return (
    <Group
      gap={6}
      px="xs"
      py={4}
      style={{ borderBottom: "1px solid var(--lp-border)" }}
      data-testid="queued-message-bar"
    >
      <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>
        ⏳ Queued: &quot;{truncateMessage(message)}&quot;
      </Text>
    </Group>
  );
}

/** Compact status bar for system/developer steering messages */
function SteeringMessageBar({
  message,
  onDismiss,
}: {
  message: SteeringMessage;
  onDismiss: () => void;
}) {
  const icon = message.role === "developer" ? "🔧" : "⚙️";
  const label = message.role === "developer" ? "Steering" : "System";
  return (
    <Group
      gap={6}
      px="xs"
      py={4}
      justify="space-between"
      style={{ borderBottom: "1px solid var(--lp-border)" }}
      data-testid="steering-message-bar"
    >
      <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>
        {icon} {label}: &quot;{truncateMessage(message.content)}&quot;
      </Text>
      <Button size="compact-xs" variant="subtle" c="dimmed" onClick={onDismiss}>
        ✕
      </Button>
    </Group>
  );
}

// ── Main Component ─────────────────────────────────────

export function CopilotConversation({
  sessionId,
  sessionType: _sessionType,
  controlPanelOpen,
  onAgentChange,
}: CopilotConversationProps) {
  const { selectedProject } = useSelectedProject();
  const owner = selectedProject?.owner;
  const repo = selectedProject?.repo;
  const { entries, rawEvents, isLoading, isError, error, sessionStatus, queuedMessage, setQueuedMessage, steeringMessage, clearSteeringMessage } =
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
    setQueuedMessage(text);
    sendPrompt.mutate({ sessionId, prompt: text, ...(mode ? { mode } : {}) });
    setPromptText("");
  }, [promptText, sessionId, sendPrompt, setQueuedMessage]);

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
      onAgentChange?.(nextAgentId === DEFAULT_SESSION_AGENT_ID ? null : nextAgentId);
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

      {/* Queued / Steering message indicators */}
      {(queuedMessage || steeringMessage) && (
        <Box style={{ borderBottom: "1px solid var(--lp-border)" }}>
          {queuedMessage && <QueuedMessageBar message={queuedMessage} />}
          {steeringMessage && (
            <SteeringMessageBar message={steeringMessage} onDismiss={clearSteeringMessage} />
          )}
        </Box>
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
