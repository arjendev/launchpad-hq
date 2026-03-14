import {
  ActionIcon,
  Badge,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useSelectedSession } from "../contexts/SessionContext.js";
import { useInbox, useInboxCount, useUpdateInboxMessage } from "../services/hooks.js";
import type { InboxMessage } from "../services/types.js";

// ── Helpers ────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1_000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function toolIcon(tool: InboxMessage["tool"]): string {
  return tool === "request_human_review" ? "🔍" : "🚫";
}

// ── Message Card ───────────────────────────────────────

function InboxMessageCard({
  message,
  onMarkRead,
  onArchive,
}: {
  message: InboxMessage;
  onMarkRead: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const isUnread = message.status === "unread";

  return (
    <UnstyledButton
      onClick={() => isUnread && onMarkRead(message.id)}
      w="100%"
      style={{ borderRadius: "var(--mantine-radius-sm)" }}
    >
      <Paper
        withBorder
        p="xs"
        radius="sm"
        style={{
          borderLeft: isUnread
            ? "3px solid var(--mantine-color-blue-6)"
            : "3px solid transparent",
          background: isUnread
            ? "var(--lp-surface-highlight, var(--mantine-color-dark-6))"
            : undefined,
        }}
      >
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Text size="md" mt={1} style={{ flexShrink: 0 }}>
            {toolIcon(message.tool)}
          </Text>
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text
              size="sm"
              fw={isUnread ? 700 : 400}
              lineClamp={2}
            >
              {message.title}
            </Text>
            <Group gap={4}>
              <Text size="xs" c="dimmed">
                {timeAgo(message.createdAt)}
              </Text>
              {isUnread && (
                <Badge size="xs" color="blue" variant="filled" circle>
                  &nbsp;
                </Badge>
              )}
            </Group>
          </Stack>
          <Tooltip label="Archive">
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={(e) => {
                e.stopPropagation();
                onArchive(message.id);
              }}
              aria-label="Archive message"
            >
              ✓
            </ActionIcon>
          </Tooltip>
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

// ── Main Panel ─────────────────────────────────────────

export function InboxPanel() {
  const { selectedProject } = useSelectedProject();
  const { selectedSession } = useSelectedSession();

  const owner = selectedProject?.owner;
  const repo = selectedProject?.repo;
  const sessionId = selectedSession?.sessionId ?? null;

  const { messages, isLoading, isError } = useInbox(owner, repo, sessionId);
  const { data: countData } = useInboxCount(owner, repo);
  const updateMessage = useUpdateInboxMessage(owner, repo);

  const unreadCount = countData?.unread ?? 0;

  // Filter out archived messages
  const visibleMessages = messages.filter((m) => m.status !== "archived");

  const handleMarkRead = (id: string) => {
    updateMessage.mutate({ id, status: "read" });
  };

  const handleArchive = (id: string) => {
    updateMessage.mutate({ id, status: "archived" });
  };

  if (!selectedProject) {
    return null;
  }

  return (
    <Stack gap="xs" p="xs" style={{ height: "100%" }}>
      {/* Header */}
      <Group gap="xs">
        <Text size="sm" fw={700}>
          📥 Inbox
        </Text>
        {unreadCount > 0 && (
          <Badge size="sm" color="red" variant="filled">
            {unreadCount}
          </Badge>
        )}
      </Group>

      {/* Content */}
      {isLoading && (
        <Stack align="center" p="sm">
          <Loader size="sm" />
        </Stack>
      )}

      {isError && (
        <Text size="xs" c="red">
          Failed to load inbox
        </Text>
      )}

      {!isLoading && !isError && visibleMessages.length === 0 && (
        <Text size="xs" c="dimmed" ta="center" p="sm">
          No messages — all clear
        </Text>
      )}

      {!isLoading && visibleMessages.length > 0 && (
        <ScrollArea style={{ flex: 1 }} offsetScrollbars>
          <Stack gap={4}>
            {visibleMessages.map((msg) => (
              <InboxMessageCard
                key={msg.id}
                message={msg}
                onMarkRead={handleMarkRead}
                onArchive={handleArchive}
              />
            ))}
          </Stack>
        </ScrollArea>
      )}
    </Stack>
  );
}
