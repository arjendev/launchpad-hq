/**
 * WorkflowIssueList — compact, filterable, sortable workflow issue table.
 *
 * Shows tracked issues with HQ-enriched workflow states, colored status badges,
 * row actions for state transitions, and a sync button to pull from GitHub.
 */
import { useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Indicator,
  Menu,
  Paper,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useWorkflowIssues, useSyncIssues, useTransitionIssue, useElicitations } from "../services/workflow-hooks.js";
import {
  WORKFLOW_STATE_CONFIG,
  WORKFLOW_STATE_SORT,
  WORKFLOW_STATES,
  type WorkflowIssue,
  type WorkflowState,
} from "../services/workflow-types.js";
import { ElicitationCard, scrollToElicitation } from "./ElicitationCard.js";

// ── Helpers ─────────────────────────────────────────────

function formatAge(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

type SortField = "status" | "number" | "age";
type SortDir = "asc" | "desc";

function sortIssues(
  issues: WorkflowIssue[],
  field: SortField,
  dir: SortDir,
): WorkflowIssue[] {
  const sorted = [...issues];
  const mult = dir === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (field) {
      case "status":
        return mult * (WORKFLOW_STATE_SORT[a.state] - WORKFLOW_STATE_SORT[b.state]);
      case "number":
        return mult * (a.number - b.number);
      case "age": {
        const aTime = new Date(a.updatedAt).getTime();
        const bTime = new Date(b.updatedAt).getTime();
        return mult * (aTime - bTime);
      }
      default:
        return 0;
    }
  });
  return sorted;
}

// ── Status Badge ────────────────────────────────────────

function StatusBadge({ state }: { state: WorkflowState }) {
  const config = WORKFLOW_STATE_CONFIG[state];
  const isNeedsInput = state === "needs-input-blocking" || state === "needs-input-async";
  return (
    <Badge
      size="xs"
      variant="light"
      color={config.color}
      className={isNeedsInput ? "lp-needs-input-badge" : undefined}
    >
      {config.emoji} {config.label}
    </Badge>
  );
}

// ── Row Actions ─────────────────────────────────────────

function RowActions({
  issue,
  owner,
  repo,
  elicitationId,
}: {
  issue: WorkflowIssue;
  owner: string;
  repo: string;
  elicitationId?: string;
}) {
  const transition = useTransitionIssue();
  const isPending = transition.isPending;

  const handleTransition = (newState: WorkflowState) => {
    transition.mutate({ owner, repo, issueNumber: issue.number, newState });
  };

  if (issue.state === "ready-for-review") {
    return (
      <Group gap={4} wrap="nowrap">
        <Tooltip label="Approve — mark as done">
          <ActionIcon
            size="xs"
            variant="light"
            color="green"
            onClick={() => handleTransition("done")}
            loading={isPending}
            aria-label="Approve"
          >
            ✓
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Request changes">
          <ActionIcon
            size="xs"
            variant="light"
            color="red"
            onClick={() => handleTransition("in-progress")}
            loading={isPending}
            aria-label="Request changes"
          >
            ✗
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  if (issue.state === "needs-input-blocking" || issue.state === "needs-input-async") {
    return (
      <Group gap={4} wrap="nowrap">
        {elicitationId ? (
          <Tooltip label="Respond to question">
            <Button
              size="compact-xs"
              variant="filled"
              color="yellow"
              onClick={() => scrollToElicitation(elicitationId)}
              aria-label="Respond"
            >
              💬 Respond
            </Button>
          </Tooltip>
        ) : (
          <Tooltip label="Mark as responded">
            <ActionIcon
              size="xs"
              variant="light"
              color="yellow"
              onClick={() => handleTransition("in-progress")}
              loading={isPending}
              aria-label="Respond"
            >
              💬
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    );
  }

  // For backlog / in-progress / done — offer a transition menu
  if (issue.state === "backlog" || issue.state === "in-progress") {
    return (
      <Menu shadow="sm" width={180} position="bottom-end">
        <Menu.Target>
          <ActionIcon size="xs" variant="subtle" color="gray" aria-label="More actions">
            ⋯
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {issue.state === "backlog" && (
            <Menu.Item onClick={() => handleTransition("in-progress")}>
              Start working
            </Menu.Item>
          )}
          {issue.state === "in-progress" && (
            <>
              <Menu.Item onClick={() => handleTransition("ready-for-review")}>
                Submit for review
              </Menu.Item>
              <Menu.Item onClick={() => handleTransition("backlog")}>
                Move to backlog
              </Menu.Item>
            </>
          )}
          <Menu.Item onClick={() => handleTransition("done")}>
            Mark done
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
  }

  return <Text size="xs" c="dimmed">—</Text>;
}

// ── Loading skeleton ────────────────────────────────────

function WorkflowSkeleton() {
  return (
    <Stack gap="xs" p="sm">
      <Group justify="space-between">
        <Skeleton height={24} width={180} />
        <Skeleton height={28} width={80} />
      </Group>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={36} radius="sm" />
      ))}
    </Stack>
  );
}

// ── Filter state options ────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...WORKFLOW_STATES.map((s) => ({
    value: s,
    label: `${WORKFLOW_STATE_CONFIG[s].emoji} ${WORKFLOW_STATE_CONFIG[s].label}`,
  })),
];

// ── Main component ──────────────────────────────────────

export function WorkflowIssueList() {
  const { selectedProject } = useSelectedProject();
  const owner = selectedProject?.owner;
  const repo = selectedProject?.repo;

  const { issues, isLoading, isError, error } = useWorkflowIssues(owner, repo);
  const sync = useSyncIssues(owner, repo);
  const { elicitations, pendingCount, timeoutMs } = useElicitations(owner, repo);

  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Map issueNumber → elicitation id for pending elicitations
  const elicitationByIssue = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of elicitations) {
      if (e.status === "pending") {
        map.set(e.issueNumber, e.id);
      }
    }
    return map;
  }, [elicitations]);

  const pendingElicitations = useMemo(
    () => elicitations.filter((e) => e.status === "pending"),
    [elicitations],
  );

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const filtered = useMemo(() => {
    let result = issues;
    if (statusFilter !== "all") {
      result = result.filter((i) => i.state === statusFilter);
    }
    if (filter.trim()) {
      const q = filter.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          `#${i.number}`.includes(q) ||
          i.project.toLowerCase().includes(q),
      );
    }
    return sortIssues(result, sortField, sortDir);
  }, [issues, statusFilter, filter, sortField, sortDir]);

  if (!selectedProject) {
    return (
      <Stack align="center" justify="center" gap="xs" p="xl" style={{ flex: 1 }}>
        <Text size="sm" c="dimmed">
          Select a project to view workflow issues
        </Text>
      </Stack>
    );
  }

  if (isLoading) return <WorkflowSkeleton />;

  if (isError) {
    return (
      <Stack align="center" justify="center" gap="xs" p="xl" style={{ flex: 1 }}>
        <Text size="sm" c="red">
          Failed to load workflow issues
        </Text>
        <Text size="xs" c="dimmed">{error?.message ?? "Unknown error"}</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="xs" p="sm" style={{ height: "100%" }}>
      {/* Header */}
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs">
          <Text size="sm" fw={700}>🔄 Workflow</Text>
          <Badge size="sm" variant="light" color="blue">
            {issues.length} tracked
          </Badge>
          {pendingCount > 0 && (
            <Indicator inline processing color="yellow" size={10}>
              <Badge size="sm" variant="filled" color="yellow">
                {pendingCount} needs input
              </Badge>
            </Indicator>
          )}
        </Group>
        <Button
          size="compact-xs"
          variant="light"
          onClick={() => sync.mutate()}
          loading={sync.isPending}
          disabled={sync.isPending}
        >
          {sync.isPending ? "Syncing…" : "⟳ Sync"}
        </Button>
      </Group>

      {/* Pending Elicitation Cards */}
      {pendingElicitations.length > 0 && owner && repo && (
        <Stack gap="sm">
          {pendingElicitations.map((e) => (
            <ElicitationCard
              key={e.id}
              elicitation={e}
              owner={owner}
              repo={repo}
              timeoutMs={timeoutMs}
            />
          ))}
        </Stack>
      )}

      {/* Filters */}
      <Group gap="xs">
        <TextInput
          placeholder="Filter issues…"
          size="xs"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 120 }}
        />
        <Select
          size="xs"
          data={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v ?? "all")}
          style={{ width: 160 }}
          allowDeselect={false}
        />
      </Group>

      {/* Table */}
      {filtered.length === 0 ? (
        <Paper withBorder p="lg" radius="sm">
          <Stack align="center" gap="xs">
            <Text size="sm" c="dimmed">
              {issues.length === 0
                ? "No issues tracked. Click Sync to pull from GitHub."
                : "No issues match the current filters."}
            </Text>
          </Stack>
        </Paper>
      ) : (
        <ScrollArea style={{ flex: 1 }} offsetScrollbars>
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders={false}
            verticalSpacing={4}
            horizontalSpacing="xs"
            style={{ fontSize: "var(--mantine-font-size-xs)" }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th
                  style={{ cursor: "pointer", userSelect: "none", width: 120 }}
                  onClick={() => toggleSort("status")}
                >
                  Status{sortIndicator("status")}
                </Table.Th>
                <Table.Th
                  style={{ cursor: "pointer", userSelect: "none", width: 50 }}
                  onClick={() => toggleSort("number")}
                >
                  #{sortIndicator("number")}
                </Table.Th>
                <Table.Th>Title</Table.Th>
                <Table.Th style={{ width: 100 }}>Project</Table.Th>
                <Table.Th
                  style={{ cursor: "pointer", userSelect: "none", width: 50 }}
                  onClick={() => toggleSort("age")}
                >
                  Age{sortIndicator("age")}
                </Table.Th>
                <Table.Th style={{ width: 70 }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((issue) => (
                <Table.Tr key={issue.number}>
                  <Table.Td>
                    <StatusBadge state={issue.state} />
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="xs"
                      component="a"
                      href={issue.ghUrl}
                      target="_blank"
                      rel="noopener"
                      c="blue"
                      style={{ textDecoration: "none" }}
                    >
                      #{issue.number}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" lineClamp={1}>{issue.title}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" lineClamp={1}>{issue.project}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{formatAge(issue.updatedAt)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <RowActions issue={issue} owner={owner!} repo={repo!} elicitationId={elicitationByIssue.get(issue.number)} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}
