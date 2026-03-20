/**
 * ActivityFeed — scrollable timeline of workflow activity events.
 *
 * Compact rows (~30px) with timestamp, icon, message. Supports real-time
 * prepending via WebSocket, urgency highlighting, and load-more pagination.
 */
import { useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  ScrollArea,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useActivityFeed } from "../services/workflow-hooks.js";
import type { ActivityEvent, ActivityEventType } from "../services/workflow-types.js";

// ── Icon / color mapping ────────────────────────────────

const EVENT_ICONS: Record<ActivityEventType, string> = {
  "issue-dispatched": "🚀",
  "progress": "⚡",
  "elicitation-requested": "💬",
  "elicitation-answered": "💬",
  "elicitation-timeout": "⏰",
  "issue-completed": "✅",
  "coordinator-started": "🟢",
  "coordinator-crashed": "🔴",
  "review-approved": "✅",
  "review-rejected": "🔄",
};

function isUrgentEvent(event: ActivityEvent): boolean {
  return event.severity === "urgent" ||
    event.type === "elicitation-requested" ||
    event.type === "coordinator-crashed";
}

function isWarningEvent(event: ActivityEvent): boolean {
  return event.severity === "warning" ||
    event.type === "elicitation-timeout";
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;

  // Same day — show time
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── Filter options ──────────────────────────────────────

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All events" },
  { value: "issue-dispatched", label: "🚀 Dispatched" },
  { value: "progress", label: "⚡ Progress" },
  { value: "elicitation-requested", label: "💬 Elicitation" },
  { value: "issue-completed", label: "✅ Completed" },
  { value: "coordinator-crashed", label: "🔴 Errors" },
  { value: "review-approved", label: "✅ Approved" },
  { value: "review-rejected", label: "🔄 Changes" },
];

// ── Event Row ───────────────────────────────────────────

function EventRow({
  event,
  onClickIssue,
}: {
  event: ActivityEvent;
  onClickIssue?: (owner: string, repo: string, issueNumber: number) => void;
}) {
  const icon = EVENT_ICONS[event.type] ?? "📌";
  const urgent = isUrgentEvent(event);
  const warning = isWarningEvent(event);

  return (
    <Group
      gap={6}
      wrap="nowrap"
      py={2}
      px="xs"
      style={{
        height: 30,
        minHeight: 30,
        cursor: event.issueNumber ? "pointer" : undefined,
        borderRadius: "var(--mantine-radius-xs)",
        backgroundColor: urgent
          ? "var(--mantine-color-red-light)"
          : warning
            ? "var(--mantine-color-yellow-light)"
            : undefined,
        transition: "background-color 0.2s",
      }}
      className="lp-activity-row"
      onClick={
        event.issueNumber && onClickIssue
          ? () => onClickIssue(event.projectOwner, event.projectRepo, event.issueNumber!)
          : undefined
      }
    >
      <Text size="xs" c="dimmed" style={{ width: 32, flexShrink: 0, textAlign: "right" }}>
        {formatTimestamp(event.timestamp)}
      </Text>
      <Text size="xs" style={{ width: 18, flexShrink: 0, textAlign: "center" }}>
        {icon}
      </Text>
      <Text size="xs" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
        {event.message}
      </Text>
      {event.issueNumber && (
        <Text size="xs" c="blue" style={{ flexShrink: 0 }}>
          #{event.issueNumber}
        </Text>
      )}
    </Group>
  );
}

// ── Main Component ──────────────────────────────────────

interface ActivityFeedProps {
  owner?: string;
  repo?: string;
  /** Callback when clicking an event's issue link */
  onNavigateToIssue?: (owner: string, repo: string, issueNumber: number) => void;
  /** Max height of the scroll area */
  maxHeight?: number | string;
}

export function ActivityFeed({
  owner,
  repo,
  onNavigateToIssue,
  maxHeight = "100%",
}: ActivityFeedProps) {
  const { events, hasMore, isLoading, isError, loadMore } = useActivityFeed(owner, repo);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    if (typeFilter === "all") return events;
    return events.filter((e) => e.type === typeFilter);
  }, [events, typeFilter]);

  const [collapsed, setCollapsed] = useState(false);

  return (
    <Stack gap={0} style={{ height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <Group
        justify="space-between"
        px="xs"
        py={4}
        style={{ borderBottom: "1px solid var(--lp-border)", flexShrink: 0 }}
      >
        <Group gap={4}>
          <Tooltip label={collapsed ? "Expand activity" : "Collapse activity"}>
            <ActionIcon
              size="xs"
              variant="subtle"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? "▸" : "▾"}
            </ActionIcon>
          </Tooltip>
          <Text size="xs" fw={600}>📡 Activity</Text>
          {events.length > 0 && (
            <Text size="xs" c="dimmed">({events.length})</Text>
          )}
        </Group>
        {!collapsed && (
          <Select
            size="xs"
            data={TYPE_FILTER_OPTIONS}
            value={typeFilter}
            onChange={(v) => setTypeFilter(v ?? "all")}
            style={{ width: 130 }}
            allowDeselect={false}
            variant="unstyled"
          />
        )}
      </Group>

      {/* Body */}
      {!collapsed && (
        <ScrollArea style={{ flex: 1, maxHeight }} offsetScrollbars>
          {isLoading && (
            <Box p="sm">
              <Text size="xs" c="dimmed">Loading activity…</Text>
            </Box>
          )}

          {isError && (
            <Box p="sm">
              <Text size="xs" c="red">Failed to load activity feed</Text>
            </Box>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <Box p="md" ta="center">
              <Text size="xs" c="dimmed">
                No activity yet. Dispatch an issue to get started.
              </Text>
            </Box>
          )}

          {filtered.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              onClickIssue={onNavigateToIssue}
            />
          ))}

          {hasMore && (
            <Box p="xs" ta="center">
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={loadMore}
              >
                Load more…
              </Button>
            </Box>
          )}
        </ScrollArea>
      )}
    </Stack>
  );
}
