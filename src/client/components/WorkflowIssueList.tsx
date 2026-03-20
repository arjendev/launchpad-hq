/**
 * WorkflowIssueList — compact, filterable, sortable workflow issue table.
 *
 * Shows tracked issues with HQ-enriched workflow states, colored status badges,
 * row actions for state transitions, dispatch button, enhanced review actions,
 * and multi-project aggregate support.
 */
import { useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Indicator,
  Menu,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useDashboard } from "../services/hooks.js";
import {
  useWorkflowIssues,
  useAllWorkflowIssues,
  useSyncIssues,
  useTransitionIssue,
  useDispatchIssue,
  useElicitations,
} from "../services/workflow-hooks.js";
import {
  WORKFLOW_STATE_CONFIG,
  WORKFLOW_STATE_SORT,
  WORKFLOW_STATES,
  type WorkflowIssue,
  type WorkflowState,
} from "../services/workflow-types.js";
import { ElicitationCard, scrollToElicitation } from "./ElicitationCard.js";
import { CreateIssueModal } from "./CreateIssueModal.js";
import { EditIssueModal } from "./EditIssueModal.js";

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

// ── Dispatch Button ─────────────────────────────────────

function DispatchButton({
  issue,
  owner,
  repo,
}: {
  issue: WorkflowIssue;
  owner: string;
  repo: string;
}) {
  const dispatch = useDispatchIssue();

  return (
    <Tooltip label="Dispatch to coordinator">
      <Button
        size="compact-xs"
        variant="light"
        color="blue"
        loading={dispatch.isPending}
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); dispatch.mutate({ owner, repo, issueNumber: issue.number }); }}
        style={{
          transition: "all 0.2s ease",
        }}
        aria-label="Dispatch issue"
      >
        ▶ Dispatch
      </Button>
    </Tooltip>
  );
}

// ── Feedback Modal ──────────────────────────────────────

function FeedbackModal({
  opened,
  onClose,
  onSubmit,
  isPending,
}: {
  opened: boolean;
  onClose: () => void;
  onSubmit: (feedback: string) => void;
  isPending: boolean;
}) {
  const [feedback, setFeedback] = useState("");

  const handleSubmit = () => {
    if (feedback.trim()) {
      onSubmit(feedback.trim());
      setFeedback("");
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Request Changes" size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Provide feedback on what needs to change. The issue will transition back to in-progress.
        </Text>
        <Textarea
          placeholder="Describe the changes needed…"
          minRows={3}
          maxRows={6}
          value={feedback}
          onChange={(e) => setFeedback(e.currentTarget.value)}
          autosize
        />
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="xs"
            color="red"
            onClick={handleSubmit}
            loading={isPending}
            disabled={!feedback.trim()}
          >
            Send Feedback
          </Button>
        </Group>
      </Stack>
    </Modal>
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const handleTransition = (newState: WorkflowState) => {
    transition.mutate({ owner, repo, issueNumber: issue.number, newState });
  };

  if (issue.state === "ready-for-review") {
    return (
      <>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Mark as done and close on GitHub">
            <Button
              size="compact-xs"
              variant="light"
              color="teal"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleTransition("done"); }}
              loading={isPending}
              aria-label="Done"
            >
              ✓ Done
            </Button>
          </Tooltip>
          <Tooltip label="Reject — won't implement">
            <Button
              size="compact-xs"
              variant="light"
              color="red"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleTransition("rejected"); }}
              loading={isPending}
              aria-label="Reject"
            >
              🚫 Reject
            </Button>
          </Tooltip>
          <Tooltip label="Request changes — send feedback">
            <ActionIcon
              size="xs"
              variant="light"
              color="orange"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); setFeedbackOpen(true); }}
              loading={isPending}
              aria-label="Request changes"
            >
              ✗
            </ActionIcon>
          </Tooltip>
        </Group>
        <FeedbackModal
          opened={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          onSubmit={() => {
            handleTransition("in-progress");
            setFeedbackOpen(false);
          }}
          isPending={isPending}
        />
      </>
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
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); scrollToElicitation(elicitationId); }}
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
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleTransition("in-progress"); }}
              loading={isPending}
              aria-label="Respond"
            >
              💬
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip label="Reject — won't implement">
          <ActionIcon
            size="xs"
            variant="light"
            color="red"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleTransition("rejected"); }}
            loading={isPending}
            aria-label="Reject"
          >
            🚫
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  // Backlog — show dispatch button + menu
  if (issue.state === "backlog") {
    return (
      <Group gap={4} wrap="nowrap">
        <DispatchButton issue={issue} owner={owner} repo={repo} />
        <Menu shadow="sm" width={180} position="bottom-end">
          <Menu.Target>
            <ActionIcon size="xs" variant="subtle" color="gray" aria-label="More actions" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              ⋯
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => handleTransition("in-progress")}>
              Start working
            </Menu.Item>
            <Menu.Item onClick={() => handleTransition("done")}>
              Mark done
            </Menu.Item>
            <Menu.Item color="red" onClick={() => handleTransition("rejected")}>
              Reject
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    );
  }

  // In-progress — offer transition menu
  if (issue.state === "in-progress") {
    return (
      <Group gap={4} wrap="nowrap">
        <DispatchButton issue={issue} owner={owner} repo={repo} />
        <Menu shadow="sm" width={180} position="bottom-end">
          <Menu.Target>
            <ActionIcon size="xs" variant="subtle" color="gray" aria-label="More actions" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              ⋯
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => handleTransition("ready-for-review")}>
              Submit for review
            </Menu.Item>
            <Menu.Item onClick={() => handleTransition("backlog")}>
              Move to backlog
            </Menu.Item>
            <Menu.Item onClick={() => handleTransition("done")}>
              Mark done
            </Menu.Item>
            <Menu.Item color="red" onClick={() => handleTransition("rejected")}>
              Reject
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
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

// ── Issue Table (shared between scoped and aggregate) ───

function IssueTable({
  issues,
  owner,
  repo,
  showProjectColumn,
  filter,
  statusFilter,
  projectFilter,
  elicitationByIssue,
  onRowClick,
}: {
  issues: WorkflowIssue[];
  owner?: string;
  repo?: string;
  showProjectColumn: boolean;
  filter: string;
  statusFilter: string;
  projectFilter: string;
  elicitationByIssue: Map<number, string>;
  onRowClick?: (issue: WorkflowIssue) => void;
}) {
  const [sortField, setSortField] = useState<SortField>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
    if (projectFilter && projectFilter !== "all") {
      result = result.filter((i) => i.project === projectFilter);
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
  }, [issues, statusFilter, projectFilter, filter, sortField, sortDir]);

  if (filtered.length === 0) {
    return (
      <Paper withBorder p="lg" radius="sm">
        <Stack align="center" gap="xs">
          <Text size="sm" c="dimmed">
            {issues.length === 0
              ? "No issues tracked. Click Sync to pull from GitHub."
              : "No issues match the current filters."}
          </Text>
        </Stack>
      </Paper>
    );
  }

  return (
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
            {showProjectColumn && (
              <Table.Th style={{ width: 100 }}>Project</Table.Th>
            )}
            <Table.Th
              style={{ cursor: "pointer", userSelect: "none", width: 50 }}
              onClick={() => toggleSort("age")}
            >
              Age{sortIndicator("age")}
            </Table.Th>
            <Table.Th style={{ width: 110 }}>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filtered.map((issue) => {
            const [issueOwner, issueRepo] = issue.project.split("/");
            const effectiveOwner = owner ?? issueOwner ?? "";
            const effectiveRepo = repo ?? issueRepo ?? "";
            return (
              <Table.Tr
                key={`${issue.project}-${issue.number}`}
                style={{
                  transition: "background-color 0.3s ease",
                  cursor: onRowClick ? "pointer" : undefined,
                }}
                onClick={() => onRowClick?.(issue)}
              >
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
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  >
                    #{issue.number}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" lineClamp={1}>{issue.title}</Text>
                </Table.Td>
                {showProjectColumn && (
                  <Table.Td>
                    <Text size="xs" c="dimmed" lineClamp={1}>{issue.project}</Text>
                  </Table.Td>
                )}
                <Table.Td>
                  <Text size="xs" c="dimmed">{formatAge(issue.updatedAt)}</Text>
                </Table.Td>
                <Table.Td>
                  <RowActions
                    issue={issue}
                    owner={effectiveOwner}
                    repo={effectiveRepo}
                    elicitationId={elicitationByIssue.get(issue.number)}
                  />
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

// ── Aggregate (All projects) view ───────────────────────

function AggregateWorkflowView() {
  const { data: dashboard } = useDashboard();
  const projects = useMemo(
    () => (dashboard?.projects ?? []).map((p) => ({ owner: p.owner, repo: p.repo })),
    [dashboard],
  );

  const { issues, isLoading, isError, error } = useAllWorkflowIssues(projects);

  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const projectFilterOptions = useMemo(() => {
    const set = new Set(issues.map((i) => i.project));
    return [
      { value: "all", label: "All projects" },
      ...[...set].sort().map((p) => ({ value: p, label: p })),
    ];
  }, [issues]);

  if (projects.length === 0) {
    return (
      <Stack align="center" justify="center" gap="xs" p="xl" style={{ flex: 1 }}>
        <Text size="sm" c="dimmed">
          No projects added yet. Add a project to get started.
        </Text>
      </Stack>
    );
  }

  if (isLoading) return <WorkflowSkeleton />;

  if (isError) {
    return (
      <Stack align="center" justify="center" gap="xs" p="xl" style={{ flex: 1 }}>
        <Text size="sm" c="red">Failed to load workflow issues</Text>
        <Text size="xs" c="dimmed">{error?.message ?? "Unknown error"}</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="xs" p="sm" style={{ height: "100%" }}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs">
          <Text size="sm" fw={700}>🔄 All Workflows</Text>
          <Badge size="sm" variant="light" color="blue">
            {issues.length} tracked
          </Badge>
        </Group>
      </Group>

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
          style={{ width: 150 }}
          allowDeselect={false}
        />
        <Select
          size="xs"
          data={projectFilterOptions}
          value={projectFilter}
          onChange={(v) => setProjectFilter(v ?? "all")}
          style={{ width: 160 }}
          allowDeselect={false}
        />
      </Group>

      <IssueTable
        issues={issues}
        showProjectColumn
        filter={filter}
        statusFilter={statusFilter}
        projectFilter={projectFilter}
        elicitationByIssue={new Map()}
      />
    </Stack>
  );
}

// ── Main component ──────────────────────────────────────

export function WorkflowIssueList() {
  const { selectedProject } = useSelectedProject();
  const owner = selectedProject?.owner;
  const repo = selectedProject?.repo;

  // When no project is selected, show the aggregate view
  if (!selectedProject) {
    return <AggregateWorkflowView />;
  }

  return <ScopedWorkflowView owner={owner!} repo={repo!} />;
}

/** Single-project scoped view */
function ScopedWorkflowView({ owner, repo }: { owner: string; repo: string }) {
  const { issues, isLoading, isError, error } = useWorkflowIssues(owner, repo);
  const sync = useSyncIssues(owner, repo);
  const { elicitations, pendingCount, timeoutMs } = useElicitations(owner, repo);

  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editIssue, setEditIssue] = useState<WorkflowIssue | null>(null);

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

  if (isLoading) return <WorkflowSkeleton />;

  if (isError) {
    return (
      <Stack align="center" justify="center" gap="xs" p="xl" style={{ flex: 1 }}>
        <Text size="sm" c="red">Failed to load workflow issues</Text>
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
        <Group gap="xs">
          <Button
            size="compact-xs"
            variant="light"
            color="green"
            onClick={() => setCreateOpen(true)}
          >
            + New
          </Button>
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
      </Group>

      {/* Pending Elicitation Cards */}
      {pendingElicitations.length > 0 && (
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

      {/* Table — single-project doesn't need project column */}
      <IssueTable
        issues={issues}
        owner={owner}
        repo={repo}
        showProjectColumn={false}
        filter={filter}
        statusFilter={statusFilter}
        projectFilter="all"
        elicitationByIssue={elicitationByIssue}
        onRowClick={(issue) => setEditIssue(issue)}
      />

      {/* Modals */}
      <CreateIssueModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        owner={owner}
        repo={repo}
      />
      <EditIssueModal
        opened={!!editIssue}
        onClose={() => setEditIssue(null)}
        issue={editIssue}
        owner={owner}
        repo={repo}
      />
    </Stack>
  );
}
