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
import { useDashboard, useRemoveProject, useInboxCount, useRegenerateDaemonToken } from "../services/hooks.js";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { AddProjectWizard } from "./AddProjectWizard.js";
import { DaemonSetupInstructions } from "./DaemonSetupInstructions.js";
import type { DashboardProject } from "../services/types.js";

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

const RUNTIME_TARGET_LABELS: Record<string, string> = {
  "wsl-devcontainer": "WSL+DC",
  wsl: "WSL",
  local: "Local",
};

function runtimeTargetLabel(target: string): string {
  return RUNTIME_TARGET_LABELS[target] ?? target;
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

function ProjectItem({
  project,
  selected,
  onSelect,
  onRemove,
  onRegenerate,
}: {
  project: DashboardProject;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRegenerate: () => void;
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
          <Group gap={6} wrap="nowrap">
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: `var(--mantine-color-${statusColor(project)}-6)`,
                flexShrink: 0,
              }}
              title={statusLabel(project)}
            />
            <Text size="sm" fw={500} truncate>
              {project.owner}/{project.repo}
            </Text>
            {unread > 0 && (
              <Badge size="xs" color="red" variant="filled">
                {unread}
              </Badge>
            )}
            <Text
              component="span"
              size="xs"
              title={project.daemonStatus === "online" ? "Daemon online" : "Daemon offline"}
            >
              {project.daemonStatus === "online" ? "🟢" : "⚫"}
            </Text>
          </Group>

          <Group gap={4} mt={4}>
            <Badge size="xs" variant="light" color="grape">
              {runtimeTargetLabel(project.runtimeTarget)}
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
                onRegenerate();
              }}
            >
              Regenerate daemon command
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
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [regenerateModal, setRegenerateModal] = useState<{
    owner: string;
    repo: string;
    token: string;
  } | null>(null);

  const handleRegenerate = (owner: string, repo: string) => {
    regenerateToken.mutate(
      { owner, repo },
      {
        onSuccess: (result) => {
          setRegenerateModal({
            owner,
            repo,
            token: result.daemonToken ?? "",
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
          />
        );
      })}

      <AddProjectWizard
        opened={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
      />

      <Modal
        opened={regenerateModal !== null}
        onClose={() => setRegenerateModal(null)}
        title="Regenerated Daemon Command"
        size="md"
      >
        {regenerateModal && (
          <Stack gap="md">
            <DaemonSetupInstructions
              owner={regenerateModal.owner}
              repo={regenerateModal.repo}
              token={regenerateModal.token}
              warning="This invalidates the previous token. Any running daemon for this project will need to reconnect with the new token."
            />
            <Group justify="flex-end" mt="xs">
              <Button onClick={() => setRegenerateModal(null)} size="xs">
                Done
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
