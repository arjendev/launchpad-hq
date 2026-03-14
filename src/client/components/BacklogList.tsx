import { useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Collapse,
  Group,
  Paper,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useIssues } from "../services/hooks.js";
import type { GitHubIssue } from "../services/types.js";

// ── Issue classification (reused from KanbanBoard) ──────

type IssueStatus = "todo" | "inProgress" | "done";

function classifyIssue(issue: GitHubIssue): IssueStatus {
  if (issue.state === "CLOSED") return "done";

  const hasInProgressLabel = issue.labels.some(
    (l) => l.name.toLowerCase() === "in-progress",
  );
  const isAssigned = issue.assignees.length > 0;

  if (hasInProgressLabel || isAssigned) return "inProgress";
  return "todo";
}

const STATUS_CONFIG: Record<IssueStatus, { color: string; label: string }> = {
  inProgress: { color: "blue", label: "In Progress" },
  todo: { color: "gray", label: "Todo" },
  done: { color: "green", label: "Done" },
};

const SORT_ORDER: Record<IssueStatus, number> = {
  inProgress: 0,
  todo: 1,
  done: 2,
};

// ── Issue row ───────────────────────────────────────────

function IssueRow({ issue, status }: { issue: GitHubIssue; status: IssueStatus }) {
  const { color, label } = STATUS_CONFIG[status];
  const url = (issue as GitHubIssue & { url?: string }).url;

  return (
    <UnstyledButton
      w="100%"
      onClick={() => {
        if (url) window.open(url, "_blank", "noopener");
      }}
      style={{ borderRadius: "var(--mantine-radius-sm)" }}
      data-testid={`backlog-issue-${issue.number}`}
    >
      <Paper
        withBorder
        px="sm"
        py={6}
        radius="sm"
        style={{ cursor: url ? "pointer" : "default" }}
      >
        <Group gap="xs" wrap="nowrap">
          <Badge size="xs" variant="light" color={color} style={{ flexShrink: 0 }}>
            {label}
          </Badge>

          <Text size="sm" fw={500} lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
            {issue.title}
          </Text>

          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            #{issue.number}
          </Text>

          {issue.assignees.length > 0 && (
            <Avatar.Group spacing="xs">
              {issue.assignees.slice(0, 2).map((a) => (
                <Tooltip key={a.login} label={a.login} withArrow>
                  <Avatar src={a.avatarUrl} size="xs" radius="xl" />
                </Tooltip>
              ))}
            </Avatar.Group>
          )}
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

// ── Loading skeleton ────────────────────────────────────

function BacklogSkeleton() {
  return (
    <Stack gap="xs" p="sm">
      <Skeleton height={20} width={160} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} height={36} radius="sm" />
      ))}
    </Stack>
  );
}

// ── Main component ──────────────────────────────────────

export function BacklogList() {
  const { selectedProject } = useSelectedProject();
  const [showDone, setShowDone] = useState(false);

  const { issues, isLoading, isError, error } = useIssues(
    selectedProject?.owner,
    selectedProject?.repo,
  );

  // Classify and sort: inProgress → todo → done
  const { active, done } = useMemo(() => {
    const classified = issues.map((issue) => ({
      issue,
      status: classifyIssue(issue),
    }));

    classified.sort((a, b) => SORT_ORDER[a.status] - SORT_ORDER[b.status]);

    return {
      active: classified.filter((c) => c.status !== "done"),
      done: classified.filter((c) => c.status === "done"),
    };
  }, [issues]);

  if (!selectedProject) {
    return (
      <Stack align="center" justify="center" gap="xs" p="xl" style={{ flex: 1 }}>
        <Text size="sm" c="dimmed">
          Select a project to view backlog
        </Text>
      </Stack>
    );
  }

  if (isLoading) return <BacklogSkeleton />;

  if (isError) {
    return (
      <Stack align="center" justify="center" gap="xs" p="xl" style={{ flex: 1 }}>
        <Text size="sm" c="red">
          Failed to load issues
        </Text>
        <Text size="xs" c="dimmed">
          {error?.message ?? "Unknown error"}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="xs" p="sm" style={{ height: "100%" }}>
      <Group gap="xs">
        <Text size="sm" fw={700}>
          📋 Backlog
        </Text>
        <Badge size="sm" variant="light" color="blue">
          {active.length} active
        </Badge>
      </Group>

      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        <Stack gap={4}>
          {active.length === 0 && done.length === 0 && (
            <Text size="xs" c="dimmed" ta="center" py="md">
              No issues found
            </Text>
          )}

          {active.map(({ issue, status }) => (
            <IssueRow key={issue.number} issue={issue} status={status} />
          ))}

          {done.length > 0 && (
            <>
              <Button
                variant="subtle"
                size="compact-xs"
                color="gray"
                onClick={() => setShowDone((v) => !v)}
                mt="xs"
                data-testid="toggle-done"
              >
                {showDone ? "Hide completed" : `Show ${done.length} completed`}
              </Button>

              <Collapse in={showDone}>
                <Stack gap={4}>
                  {done.map(({ issue, status }) => (
                    <IssueRow key={issue.number} issue={issue} status={status} />
                  ))}
                </Stack>
              </Collapse>
            </>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
