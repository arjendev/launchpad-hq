import { useState } from "react";
import {
  Accordion,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Timeline,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  useDevcontainers,
  useCopilotSessions,
  useCopilotSession,
  useAttentionItems,
  useAttentionCount,
  useDismissAttention,
} from "../services/hooks.js";
import type {
  DevContainer,
  CopilotSessionSummary,
  AttentionItem,
  AttentionSeverity,
  SessionStatus,
} from "../services/types.js";

// ── Helpers ────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const severityColor: Record<AttentionSeverity, string> = {
  info: "blue",
  warning: "yellow",
  critical: "red",
};

const sessionStatusColor: Record<SessionStatus, string> = {
  active: "green",
  idle: "yellow",
  completed: "gray",
  error: "red",
};

// ── Devcontainer Section ───────────────────────────────

function ContainerCard({ container }: { container: DevContainer }) {
  const isRunning = container.status === "running";
  return (
    <Paper withBorder p="xs" radius="sm">
      <Group gap="xs" wrap="nowrap">
        <ThemeIcon
          size="xs"
          radius="xl"
          color={isRunning ? "green" : "red"}
          variant="filled"
        >
          <Box w={6} h={6} style={{ borderRadius: "50%" }} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500} truncate>
            {container.name}
          </Text>
          {container.repository && (
            <Text size="xs" c="dimmed" truncate>
              {container.repository}
            </Text>
          )}
          {container.ports.length > 0 && (
            <Group gap={4}>
              {container.ports.map((p) => (
                <Badge key={p} size="xs" variant="light">
                  {p}
                </Badge>
              ))}
            </Group>
          )}
        </Stack>
        <Badge size="xs" color={isRunning ? "green" : "red"} variant="dot">
          {container.status}
        </Badge>
      </Group>
    </Paper>
  );
}

function DevcontainersSection() {
  const { containers, isLoading, isError } = useDevcontainers();

  if (isLoading) {
    return (
      <Stack align="center" p="sm">
        <Loader size="sm" />
      </Stack>
    );
  }

  if (isError) {
    return (
      <Text size="sm" c="red" p="xs">
        Failed to load devcontainers
      </Text>
    );
  }

  if (containers.length === 0) {
    return (
      <Text size="sm" c="dimmed" p="xs" ta="center">
        No devcontainers running
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {containers.map((c) => (
        <ContainerCard key={c.containerId} container={c} />
      ))}
    </Stack>
  );
}

// ── Copilot Sessions Section ───────────────────────────

function ConversationHistory({ sessionId }: { sessionId: string }) {
  const { data: session, isLoading } = useCopilotSession(sessionId);

  if (isLoading) {
    return <Loader size="xs" />;
  }

  if (!session || session.conversationHistory.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No conversation history
      </Text>
    );
  }

  return (
    <Timeline active={session.conversationHistory.length - 1} bulletSize={16} lineWidth={2}>
      {session.conversationHistory.slice(-5).map((msg) => (
        <Timeline.Item
          key={msg.id}
          bullet={
            <Text size="xs" fw={700}>
              {msg.role === "user" ? "U" : msg.role === "assistant" ? "A" : "S"}
            </Text>
          }
          title={
            <Text size="xs" fw={500}>
              {msg.role}
            </Text>
          }
        >
          <Text size="xs" c="dimmed" lineClamp={3}>
            {msg.content}
          </Text>
          <Text size="xs" c="dimmed">
            {timeAgo(msg.timestamp)}
          </Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}

function CopilotSessionCard({ session }: { session: CopilotSessionSummary }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Paper
      withBorder
      p="xs"
      radius="sm"
      style={{ cursor: "pointer" }}
      onClick={() => setExpanded((prev) => !prev)}
    >
      <Group gap="xs" wrap="nowrap" mb={expanded ? "xs" : 0}>
        <Badge
          size="xs"
          color={sessionStatusColor[session.status]}
          variant="dot"
        >
          {session.status}
        </Badge>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          {session.repository && (
            <Text size="sm" fw={500} truncate>
              {session.repository}
            </Text>
          )}
          {session.currentTask && (
            <Text size="xs" c="dimmed" lineClamp={2}>
              {session.currentTask}
            </Text>
          )}
        </Stack>
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
          {timeAgo(session.startedAt)}
        </Text>
      </Group>
      <Group gap={4}>
        <Badge size="xs" variant="light" color="gray">
          {session.messageCount} msgs
        </Badge>
        {session.adapter === "mock" && (
          <Badge size="xs" variant="light" color="grape">
            mock
          </Badge>
        )}
      </Group>
      {expanded && (
        <Box mt="xs" onClick={(e) => e.stopPropagation()}>
          <ConversationHistory sessionId={session.id} />
        </Box>
      )}
    </Paper>
  );
}

function CopilotSessionsSection() {
  const { sessions, isLoading, isError } = useCopilotSessions();

  if (isLoading) {
    return (
      <Stack align="center" p="sm">
        <Loader size="sm" />
      </Stack>
    );
  }

  if (isError) {
    return (
      <Text size="sm" c="red" p="xs">
        Failed to load Copilot sessions
      </Text>
    );
  }

  if (sessions.length === 0) {
    return (
      <Text size="sm" c="dimmed" p="xs" ta="center">
        No active Copilot sessions
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {sessions.map((s) => (
        <CopilotSessionCard key={s.id} session={s} />
      ))}
    </Stack>
  );
}

// ── Attention Section ──────────────────────────────────

function AttentionItemCard({ item }: { item: AttentionItem }) {
  const dismiss = useDismissAttention();

  return (
    <Paper withBorder p="xs" radius="sm">
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <ThemeIcon
          size="xs"
          radius="xl"
          color={severityColor[item.severity]}
          variant="filled"
          mt={2}
        >
          <Box w={6} h={6} style={{ borderRadius: "50%" }} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" lineClamp={2}>
            {item.message}
          </Text>
          <Group gap={4}>
            <Badge size="xs" color={severityColor[item.severity]} variant="light">
              {item.severity}
            </Badge>
            <Text size="xs" c="dimmed">
              {item.project}
            </Text>
            <Text size="xs" c="dimmed">
              {timeAgo(item.createdAt)}
            </Text>
          </Group>
        </Stack>
        <Tooltip label="Dismiss">
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => dismiss.mutate(item.id)}
            loading={dismiss.isPending}
          >
            ✕
          </Button>
        </Tooltip>
      </Group>
    </Paper>
  );
}

function AttentionSection() {
  const { data, isLoading, isError } = useAttentionItems();
  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <Stack align="center" p="sm">
        <Loader size="sm" />
      </Stack>
    );
  }

  if (isError) {
    return (
      <Text size="sm" c="red" p="xs">
        Failed to load attention items
      </Text>
    );
  }

  if (items.length === 0) {
    return (
      <Text size="sm" c="dimmed" p="xs" ta="center">
        All clear — no items need attention
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {items.map((item) => (
        <AttentionItemCard key={item.id} item={item} />
      ))}
    </Stack>
  );
}

// ── Main Panel ─────────────────────────────────────────

function AttentionBadge() {
  const { data } = useAttentionCount();
  if (!data || data.total === 0) return null;
  return (
    <Badge size="sm" color="red" variant="filled" ml={4}>
      {data.total}
    </Badge>
  );
}

export function SessionsPanel() {
  return (
    <Stack gap={0} p="sm">
      <Title order={4} mb="sm">
        Sessions
      </Title>

      <Accordion
        multiple
        defaultValue={["devcontainers", "copilot", "attention"]}
        variant="separated"
        styles={{
          content: { padding: "var(--mantine-spacing-xs)" },
          control: { padding: "var(--mantine-spacing-xs)" },
        }}
      >
        <Accordion.Item value="devcontainers">
          <Accordion.Control>
            <Text size="sm" fw={600}>
              🐳 Devcontainers
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <DevcontainersSection />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="copilot">
          <Accordion.Control>
            <Text size="sm" fw={600}>
              🤖 Copilot Sessions
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <CopilotSessionsSection />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="attention">
          <Accordion.Control>
            <Group gap={0}>
              <Text size="sm" fw={600}>
                🔔 Attention
              </Text>
              <AttentionBadge />
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <AttentionSection />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
