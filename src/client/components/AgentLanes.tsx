import { memo, useState } from "react";
import {
  Badge,
  Box,
  Collapse,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import type { ActiveSubagent, ActiveToolCall } from "../services/types.js";

// ── Single agent lane ──────────────────────────────────

const AgentLane = memo(function AgentLane({
  agent,
  expanded,
  onToggle,
}: {
  agent: ActiveSubagent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const toolCount = agent.activeToolCalls.length;
  const lastEvent = agent.recentEvents[agent.recentEvents.length - 1];

  return (
    <Paper
      withBorder
      radius="sm"
      p={0}
      style={{ overflow: "hidden" }}
      data-testid={`agent-lane-${agent.id}`}
    >
      {/* Header — always visible, click to toggle */}
      <UnstyledButton
        onClick={onToggle}
        w="100%"
        p="xs"
        style={{
          backgroundColor: expanded
            ? "var(--mantine-color-violet-light)"
            : undefined,
        }}
      >
        <Group gap={6} wrap="nowrap" justify="space-between">
          <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm">🤖</Text>
            <Text size="sm" fw={500} truncate>
              {agent.displayName ?? agent.name}
            </Text>
            {agent.intent && (
              <Text size="xs" c="dimmed" truncate>
                — {agent.intent}
              </Text>
            )}
          </Group>

          <Group gap={4} wrap="nowrap">
            {toolCount > 0 && (
              <Badge size="xs" color="orange" variant="light">
                🔧 {toolCount}
              </Badge>
            )}
            {agent.status === "running" && <Loader size={12} type="dots" />}
            <Text size="xs" c="dimmed">
              {expanded ? "▲" : "▼"}
            </Text>
          </Group>
        </Group>
      </UnstyledButton>

      {/* Expanded detail */}
      <Collapse in={expanded}>
        <Box px="xs" pb="xs">
          <Stack gap={4}>
            {/* Active tool calls */}
            {agent.activeToolCalls.map((tool) => (
              <ToolCallLine key={tool.id} tool={tool} />
            ))}

            {/* Recent events */}
            {agent.recentEvents.length > 0 && (
              <Stack gap={2} mt={2}>
                {agent.recentEvents.slice(-5).map((evt, i) => (
                  <Group key={`${evt.timestamp}-${i}`} gap={4} wrap="nowrap">
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                      {new Date(evt.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </Text>
                    <Text size="xs" truncate>
                      {evt.summary}
                    </Text>
                  </Group>
                ))}
              </Stack>
            )}

            {agent.recentEvents.length === 0 && agent.activeToolCalls.length === 0 && (
              <Text size="xs" c="dimmed" fs="italic">
                Working…
              </Text>
            )}
          </Stack>
        </Box>
      </Collapse>
    </Paper>
  );
});

// ── Tool call line ─────────────────────────────────────

const ToolCallLine = memo(function ToolCallLine({
  tool,
}: {
  tool: ActiveToolCall;
}) {
  return (
    <Group gap={4} wrap="nowrap">
      <Badge size="xs" color="orange" variant="light">
        🔧 {tool.name}
      </Badge>
      {tool.status === "running" && <Loader size={10} type="dots" />}
      {tool.progress && (
        <Text size="xs" c="dimmed" truncate>
          {tool.progress}
        </Text>
      )}
    </Group>
  );
});

// ── Lane container ─────────────────────────────────────

export interface AgentLanesProps {
  agents: ActiveSubagent[];
  /** When true, show agents in side-by-side columns instead of stacked lanes */
  columnMode?: boolean;
}

export const AgentLanes = memo(function AgentLanes({
  agents,
  columnMode = false,
}: AgentLanesProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  if (agents.length === 0) return null;

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (columnMode) {
    return (
      <Box
        px="xs"
        py={6}
        style={{
          borderBottom: "1px solid var(--lp-border)",
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(agents.length + 1, 4)}, 1fr)`,
          gap: 6,
        }}
        data-testid="agent-columns"
      >
        {agents.map((agent) => (
          <AgentLane
            key={agent.id}
            agent={agent}
            expanded={true}
            onToggle={() => toggle(agent.id)}
          />
        ))}
      </Box>
    );
  }

  return (
    <Box
      px="xs"
      py={6}
      style={{ borderBottom: "1px solid var(--lp-border)" }}
      data-testid="agent-lanes"
    >
      <Stack gap={4}>
        {agents.map((agent) => (
          <AgentLane
            key={agent.id}
            agent={agent}
            expanded={expandedIds.has(agent.id)}
            onToggle={() => toggle(agent.id)}
          />
        ))}
      </Stack>
    </Box>
  );
});
