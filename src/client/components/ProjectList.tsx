import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDashboard, useRemoveProject, useInboxCount, useRegenerateDaemonToken, useGetProjectDetail } from "../services/hooks.js";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { AddProjectWizard } from "./AddProjectWizard.js";
import { DaemonSetupInstructions } from "./DaemonSetupInstructions.js";
import type { DashboardProject } from "../services/types.js";
import { useWorkflowIssues, useCoordinatorStatus } from "../services/workflow-hooks.js";

function statusColor(project: DashboardProject): string {
  if (project.isArchived) return "gray";
  if (project.openIssueCount > 10 || project.openPrCount > 5) return "yellow";
  return "green";
}

function statusLabel(project: DashboardProject): string {
  if (project.isArchived) return "archived";
  if (project.openIssueCount > 10 || project.openPrCount > 5)
    return "needs attention";
  return "healthy";
}

function workStateLabel(state: string): string | null {
  switch (state) {
    case "working":
      return "🔨 working";
    case "awaiting":
      return "⏳ awaiting";
    default:
      return null;
  }
}

/** Compact workflow status badge — summarizes tracked issues and coordinator health. */
function WorkflowBadge({ owner, repo }: { owner: string; repo: string }) {
  const { issues } = useWorkflowIssues(owner, repo);
  const { coordinator } = useCoordinatorStatus(owner, repo);

  if (issues.length === 0 && !coordinator) return null;

  // Show coordinator status if active/starting
  if (coordinator && (coordinator.status === "active" || coordinator.status === "starting")) {
    const activeDispatches = coordinator.activeDispatches?.filter(
      (d) => d.status === "running" || d.status === "pending",
    ).length ?? 0;
    if (activeDispatches > 0) {
      return (
        <Badge
          size="xs"
          variant="filled"
          color="blue"
          style={{ transition: "all 0.3s ease" }}
        >
          🔵 {activeDispatches} dispatched
        </Badge>
      );
    }
  }

  if (coordinator?.status === "crashed") {
    return (
      <Badge size="xs" variant="filled" color="red" style={{ transition: "all 0.3s ease" }}>
        🔴 crashed
      </Badge>
    );
  }

  if (issues.length === 0) return null;

  const needsAttention = issues.some(
    (i) =>
      i.state === "needs-input-blocking" ||
      i.state === "needs-input-async" ||
      i.state === "ready-for-review",
  );
  const inProgress = issues.filter((i) => i.state === "in-progress").length;
  const allDone = issues.every((i) => i.state === "done");

  if (needsAttention) {
    return (
      <Badge size="xs" variant="filled" color="yellow" style={{ transition: "all 0.3s ease" }}>
        🟡 action needed
      </Badge>
    );
  }
  if (allDone) {
    return (
      <Badge size="xs" variant="light" color="green" style={{ transition: "all 0.3s ease" }}>
        🟢 all done
      </Badge>
    );
  }
  if (inProgress > 0) {
    return (
      <Badge size="xs" variant="light" color="blue" style={{ transition: "all 0.3s ease" }}>
        🔵 {inProgress} active
      </Badge>
    );
  }
  return null;
}

function ProjectItem({
  project,
  selected,
  onSelect,
  onRemove,
  onRegenerate,
  onShowDaemonCommand,
}: {
  project: DashboardProject;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRegenerate: () => void;
  onShowDaemonCommand: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { data: inboxData } = useInboxCount(project.owner, project.repo);
  const unread = inboxData?.unread ?? 0;

  return (
    <UnstyledButton
      component="div"
      onClick={onSelect}
      p="xs"
      style={{
        borderRadius: "var(--mantine-radius-sm)",
        backgroundColor: selected
          ? "var(--mantine-color-blue-light)"
          : undefined,
        cursor: "pointer",
      }}
      w="100%"
    >
      <Group justify="space-between" wrap="nowrap" gap={4}>
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap" align="flex-start">
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: `var(--mantine-color-${statusColor(project)}-6)`,
                flexShrink: 0,
                marginTop: 5,
              }}
              title={statusLabel(project)}
            />
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Group gap={6} wrap="wrap">
                <Text size="sm" fw={500} style={{ wordBreak: "break-word" }}>
                  {project.owner}/{project.repo}
                </Text>
                {unread > 0 && (
                  <Badge size="xs" color="red" variant="filled">
                    {unread}
                  </Badge>
                )}
              </Group>

            </Box>
          </Group>

          <Group gap={4} mt={4}>
            <Badge size="xs" variant="light" color={project.daemonStatus === "online" ? "green" : "gray"}>
              {project.daemonStatus === "online" ? "Online" : "Offline"}
            </Badge>

            <Badge size="xs" variant="light" color="violet">
              {project.openIssueCount} issues
            </Badge>
            <Badge size="xs" variant="light" color="cyan">
              {project.openPrCount} PRs
            </Badge>
            {project.daemonStatus === "online" && workStateLabel(project.workState) && (
              <Badge size="xs" variant="light" color="blue">
                {workStateLabel(project.workState)}
              </Badge>
            )}
            <WorkflowBadge owner={project.owner} repo={project.repo} />
          </Group>
        </Box>

        <Group gap={2} wrap="nowrap">
          <Menu shadow="md" width={220} position="bottom-end">
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              size="sm"
              color="gray"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Actions for ${project.owner}/${project.repo}`}
            >
              ⋯
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={(e) => {
                e.stopPropagation();
                onShowDaemonCommand();
              }}
            >
              Show daemon command
            </Menu.Item>
            <Menu.Item
              onClick={(e) => {
                e.stopPropagation();
                onRegenerate();
              }}
            >
              Renew daemon token
            </Menu.Item>
            <Menu.Divider />
            {!confirmRemove ? (
              <Menu.Item
                color="red"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmRemove(true);
                }}
              >
                Remove project
              </Menu.Item>
            ) : (
              <Menu.Item
                color="red"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                  setConfirmRemove(false);
                }}
              >
                Confirm remove
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
        </Group>
      </Group>
    </UnstyledButton>
  );
}

export function ProjectList() {
  const { data, isLoading, isError, error } = useDashboard();
  const { selectedProject, selectProject } = useSelectedProject();
  const removeProject = useRemoveProject();
  const regenerateToken = useRegenerateDaemonToken();
  const getProjectDetail = useGetProjectDetail();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [daemonModal, setDaemonModal] = useState<{
    owner: string;
    repo: string;
    token: string;
    isRenewed: boolean;
  } | null>(null);

  const handleRegenerate = (owner: string, repo: string) => {
    regenerateToken.mutate(
      { owner, repo },
      {
        onSuccess: (result) => {
          setDaemonModal({
            owner,
            repo,
            token: result.daemonToken ?? "",
            isRenewed: true,
          });
        },
      },
    );
  };

  const handleShowDaemonCommand = (owner: string, repo: string) => {
    getProjectDetail.mutate(
      { owner, repo },
      {
        onSuccess: (result) => {
          setDaemonModal({
            owner,
            repo,
            token: result.daemonToken ?? "",
            isRenewed: false,
          });
        },
      },
    );
  };

  return (
    <Stack gap="xs" p="md">
      <Group justify="space-between">
        <Title order={4}>Projects</Title>
        <Button
          size="compact-xs"
          variant="light"
          onClick={() => setAddDialogOpen(true)}
        >
          + Add
        </Button>
      </Group>

      {isLoading && (
        <Stack align="center" py="xl">
          <Loader size="sm" />
          <Text size="xs" c="dimmed">
            Loading projects…
          </Text>
        </Stack>
      )}

      {isError && (
        <Text size="sm" c="red">
          {error?.message ?? "Failed to load projects"}
        </Text>
      )}

      {data && data.projects.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="xl">
          No projects added yet
        </Text>
      )}

      {/* "All Projects" aggregate selector */}
      {data && data.projects.length > 1 && (
        <UnstyledButton
          component="div"
          onClick={() => selectProject(null)}
          p="xs"
          style={{
            borderRadius: "var(--mantine-radius-sm)",
            backgroundColor: !selectedProject
              ? "var(--mantine-color-blue-light)"
              : undefined,
            cursor: "pointer",
          }}
          w="100%"
        >
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={500}>📊 All Projects</Text>
            <Badge size="xs" variant="light" color="gray">
              {data.projects.length}
            </Badge>
          </Group>
        </UnstyledButton>
      )}

      {data?.projects.map((project) => {
        const key = `${project.owner}/${project.repo}`;
        const isSelected =
          selectedProject?.owner === project.owner &&
          selectedProject?.repo === project.repo;
        return (
          <ProjectItem
            key={key}
            project={project}
            selected={isSelected}
            onSelect={() => selectProject(isSelected ? null : project)}
            onRemove={() =>
              removeProject.mutate({
                owner: project.owner,
                repo: project.repo,
              })
            }
            onRegenerate={() => handleRegenerate(project.owner, project.repo)}
            onShowDaemonCommand={() => handleShowDaemonCommand(project.owner, project.repo)}
          />
        );
      })}

      <AddProjectWizard
        opened={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
      />

      <Modal
        opened={daemonModal !== null}
        onClose={() => setDaemonModal(null)}
        title={daemonModal?.isRenewed ? "Renewed Daemon Token" : "Daemon Command"}
        size="md"
      >
        {daemonModal && (
          <Stack gap="md">
            <DaemonSetupInstructions
              owner={daemonModal.owner}
              repo={daemonModal.repo}
              token={daemonModal.token}
              warning={daemonModal.isRenewed
                ? "This invalidates the previous token. Any running daemon for this project will need to reconnect with the new token."
                : undefined}
            />
            <Group justify="flex-end" mt="xs">
              <Button onClick={() => setDaemonModal(null)} size="xs">
                Done
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
