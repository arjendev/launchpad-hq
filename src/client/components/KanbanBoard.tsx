import { useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Card,
  Flex,
  Group,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useSelectedProject } from "../contexts/ProjectContext";
import { useIssues } from "../api/hooks";
import type { GitHubIssue } from "../api/types";

// ── Column classification ───────────────────────────────

function classifyIssue(
  issue: GitHubIssue,
): "todo" | "inProgress" | "done" {
  if (issue.state === "CLOSED") return "done";

  const hasInProgressLabel = issue.labels.some(
    (l) => l.name.toLowerCase() === "in-progress",
  );
  const isAssigned = issue.assignees.length > 0;

  if (hasInProgressLabel || isAssigned) return "inProgress";
  return "todo";
}

// ── Issue card ──────────────────────────────────────────

function IssueCard({ issue }: { issue: GitHubIssue }) {
  return (
    <Card withBorder padding="sm" radius="sm">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm" fw={500} lineClamp={2}>
            <Text span c="dimmed" size="xs">
              #{issue.number}
            </Text>{" "}
            {issue.title}
          </Text>

          {issue.labels.length > 0 && (
            <Group gap={4} wrap="wrap">
              {issue.labels.map((label) => (
                <Badge
                  key={label.name}
                  size="xs"
                  variant="light"
                  color={`#${label.color}`}
                >
                  {label.name}
                </Badge>
              ))}
            </Group>
          )}
        </Stack>

        {issue.assignees.length > 0 && (
          <Avatar.Group>
            {issue.assignees.slice(0, 3).map((a) => (
              <Tooltip key={a.login} label={a.login} withArrow>
                <Avatar src={a.avatarUrl} size="sm" radius="xl" />
              </Tooltip>
            ))}
          </Avatar.Group>
        )}
      </Group>
    </Card>
  );
}

// ── Column ──────────────────────────────────────────────

interface ColumnProps {
  title: string;
  color: string;
  issues: GitHubIssue[];
}

function KanbanColumn({ title, color, issues }: ColumnProps) {
  return (
    <Stack gap="xs" style={{ flex: 1, minWidth: 200 }}>
      <Group gap="xs">
        <Text fw={600} size="sm" c={color}>
          {title}
        </Text>
        <Badge size="sm" variant="light" color={color} circle>
          {issues.length}
        </Badge>
      </Group>

      {issues.length === 0 ? (
        <Text size="xs" c="dimmed" ta="center" py="xl">
          No issues
        </Text>
      ) : (
        issues.map((issue) => <IssueCard key={issue.number} issue={issue} />)
      )}
    </Stack>
  );
}

// ── Loading skeleton ────────────────────────────────────

function KanbanSkeleton() {
  return (
    <Stack gap="md" p="md" style={{ flex: 1, minWidth: 0 }}>
      <Skeleton height={28} width={180} />
      <Skeleton height={20} width={240} />
      <Flex gap="md" wrap="wrap" style={{ flex: 1 }}>
        {[0, 1, 2].map((col) => (
          <Stack key={col} gap="xs" style={{ flex: 1, minWidth: 200 }}>
            <Skeleton height={20} width={100} />
            {[0, 1, 2].map((card) => (
              <Skeleton key={card} height={70} radius="sm" />
            ))}
          </Stack>
        ))}
      </Flex>
    </Stack>
  );
}

// ── Main component ──────────────────────────────────────

export function KanbanBoard() {
  const { selectedProject } = useSelectedProject();
  const [search, setSearch] = useState("");

  const { issues, isLoading, isError, error } = useIssues(
    selectedProject?.owner,
    selectedProject?.repo,
  );

  // Filter by search term
  const filtered = useMemo(() => {
    if (!search.trim()) return issues;
    const q = search.toLowerCase();
    return issues.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        `#${i.number}`.includes(q) ||
        i.labels.some((l) => l.name.toLowerCase().includes(q)),
    );
  }, [issues, search]);

  // Classify into columns
  const columns = useMemo(() => {
    const todo: GitHubIssue[] = [];
    const inProgress: GitHubIssue[] = [];
    const done: GitHubIssue[] = [];

    for (const issue of filtered) {
      const col = classifyIssue(issue);
      if (col === "todo") todo.push(issue);
      else if (col === "inProgress") inProgress.push(issue);
      else done.push(issue);
    }

    return { todo, inProgress, done };
  }, [filtered]);

  // ── Empty state: no project selected ──────────────────
  if (!selectedProject) {
    return (
      <Stack align="center" justify="center" gap="xs" p="xl" h="100%">
        <Title order={4} c="dimmed">
          Select a project from the sidebar
        </Title>
        <Text size="sm" c="dimmed">
          Choose a project to view its issue board
        </Text>
      </Stack>
    );
  }

  // ── Loading state ─────────────────────────────────────
  if (isLoading) {
    return <KanbanSkeleton />;
  }

  // ── Error state ───────────────────────────────────────
  if (isError) {
    return (
      <Stack align="center" justify="center" gap="xs" p="xl" h="100%">
        <Title order={4} c="red">
          Failed to load issues
        </Title>
        <Text size="sm" c="dimmed">
          {error?.message ?? "Unknown error"}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md" p="md" style={{ flex: 1, minWidth: 0 }}>
      <Title order={4}>
        {selectedProject.owner}/{selectedProject.repo}
      </Title>

      <TextInput
        placeholder="Filter issues…"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        size="sm"
      />

      <Flex gap="md" wrap="wrap" style={{ flex: 1 }}>
        <KanbanColumn title="Todo" color="blue" issues={columns.todo} />
        <KanbanColumn
          title="In Progress"
          color="yellow"
          issues={columns.inProgress}
        />
        <KanbanColumn title="Done" color="green" issues={columns.done} />
      </Flex>
    </Stack>
  );
}
