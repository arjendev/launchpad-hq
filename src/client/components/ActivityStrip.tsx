import { memo } from "react";
import {
  Badge,
  Box,
  Collapse,
  Group,
  Loader,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import type { SessionActivity, ActiveToolCall, ActiveSubagent, BackgroundTask } from "../services/types.js";

// ── Phase label map ────────────────────────────────────

const phaseConfig: Record<
  SessionActivity["phase"],
  { emoji: string; label: string; color: string }
> = {
  idle: { emoji: "✅", label: "Idle", color: "gray" },
  thinking: { emoji: "🧠", label: "Thinking", color: "blue" },
  tool: { emoji: "🔧", label: "Running tool", color: "orange" },
  subagent: { emoji: "🤖", label: "Agent working", color: "violet" },
  waiting: { emoji: "⏳", label: "Waiting for input", color: "yellow" },
  error: { emoji: "❌", label: "Error", color: "red" },
};

// ── Tool pill ──────────────────────────────────────────

const ToolPill = memo(function ToolPill({ tool }: { tool: ActiveToolCall }) {
  return (
    <Tooltip label={tool.progress ?? `Running ${tool.name}`} withArrow>
      <Badge
        size="sm"
        variant="light"
        color="orange"
        leftSection="🔧"
        data-testid={`tool-pill-${tool.id}`}
      >
        {tool.name}
        {tool.progress ? ` — ${tool.progress}` : ""}
      </Badge>
    </Tooltip>
  );
});

// ── Subagent pill ──────────────────────────────────────

const SubagentPill = memo(function SubagentPill({
  agent,
}: {
  agent: ActiveSubagent;
}) {
  const label = agent.displayName ?? agent.name;
  const toolCount = agent.activeToolCalls.length;
  const lastEvent = agent.recentEvents[agent.recentEvents.length - 1];

  return (
    <Tooltip
      label={`${label}: ${lastEvent?.summary ?? "Working…"}${toolCount ? ` (${toolCount} tool${toolCount > 1 ? "s" : ""})` : ""}`}
      withArrow
    >
      <Badge
        size="sm"
        variant="light"
        color="violet"
        leftSection="🤖"
        data-testid={`subagent-pill-${agent.id}`}
      >
        {label}
        {agent.intent ? ` — ${agent.intent}` : ""}
      </Badge>
    </Tooltip>
  );
});

// ── Background task pill ────────────────────────────────

const BackgroundPill = memo(function BackgroundPill({
  task,
}: {
  task: BackgroundTask;
}) {
  return (
    <Badge size="xs" variant="dot" color="gray" data-testid={`bg-pill-${task.id}`}>
      {task.description}
    </Badge>
  );
});

// ── Token usage display ────────────────────────────────

const TokenUsage = memo(function TokenUsage({
  usage,
}: {
  usage: NonNullable<SessionActivity["tokenUsage"]>;
}) {
  const formatted = usage.limit
    ? `${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()}`
    : usage.used.toLocaleString();
  return (
    <Tooltip label="Token usage" withArrow>
      <Text size="xs" c="dimmed" data-testid="token-usage">
        🪙 {formatted}
      </Text>
    </Tooltip>
  );
});

// ── Main strip component ──────────────────────────────

export interface ActivityStripProps {
  activity: SessionActivity;
}

export const ActivityStrip = memo(function ActivityStrip({
  activity,
}: ActivityStripProps) {
  const config = phaseConfig[activity.phase];
  const hasActiveWork =
    activity.phase !== "idle" ||
    activity.backgroundTasks.length > 0 ||
    activity.tokenUsage != null;

  return (
    <Collapse in={hasActiveWork} data-testid="activity-strip">
      <Box
        px="xs"
        py={6}
        style={{
          borderBottom: "1px solid var(--lp-border)",
          backgroundColor: "var(--mantine-color-dark-7, var(--mantine-color-gray-0))",
        }}
      >
        <Stack gap={4}>
          {/* Phase + intent row */}
          <Group gap="xs" justify="space-between" wrap="nowrap">
            <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
              {activity.phase !== "idle" && (
                <Badge
                  size="sm"
                  variant="filled"
                  color={config.color}
                  leftSection={config.emoji}
                  data-testid="phase-badge"
                >
                  {config.label}
                </Badge>
              )}
              {activity.phase !== "idle" && activity.phase === "thinking" && (
                <Loader size={14} type="dots" />
              )}
              {activity.intent && (
                <Text size="xs" c="dimmed" truncate data-testid="intent-text">
                  {activity.intent}
                </Text>
              )}
            </Group>

            {activity.tokenUsage && <TokenUsage usage={activity.tokenUsage} />}
          </Group>

          {/* Active tool calls */}
          {activity.activeToolCalls.length > 0 && (
            <Group gap={4} wrap="wrap">
              {activity.activeToolCalls.map((tool) => (
                <ToolPill key={tool.id} tool={tool} />
              ))}
            </Group>
          )}

          {/* Active subagents */}
          {activity.activeSubagents.length > 0 && (
            <Group gap={4} wrap="wrap">
              {activity.activeSubagents.map((agent) => (
                <SubagentPill key={agent.id} agent={agent} />
              ))}
            </Group>
          )}

          {/* Background tasks */}
          {activity.backgroundTasks.length > 0 && (
            <Group gap={4} wrap="wrap">
              <Text size="xs" c="dimmed">
                Background:
              </Text>
              {activity.backgroundTasks.map((task) => (
                <BackgroundPill key={task.id} task={task} />
              ))}
            </Group>
          )}
        </Stack>
      </Box>
    </Collapse>
  );
});
