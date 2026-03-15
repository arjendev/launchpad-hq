import { Paper, Group, Stack, Text, Anchor, ActionIcon, Box, Tooltip } from "@mantine/core";
import { IconExternalLink, IconPlugConnected } from "@tabler/icons-react";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useDaemonForProject, useTunnelStatus } from "../services/hooks.js";
import { usePreviewList, buildPreviewUrl } from "../services/preview-hooks.js";

export function DaemonInfoBar() {
  const { selectedProject } = useSelectedProject();
  const projectId = selectedProject
    ? `${selectedProject.owner}/${selectedProject.repo}`
    : undefined;

  const { daemon, isLoading } = useDaemonForProject(projectId);
  const { data: tunnel } = useTunnelStatus();
  const { data: previews } = usePreviewList();

  const isOnline = !!daemon;

  // Filter previews for the current project
  const projectPreviews = previews?.filter((p) => p.projectId === projectId) ?? [];
  const previewUrls = projectPreviews
    .map((p) => ({ projectId: p.projectId, url: buildPreviewUrl(tunnel ?? undefined, p.projectId) }))
    .filter((p): p is { projectId: string; url: string } => !!p.url);

  if (!selectedProject || isLoading) return null;

  return (
    <Paper
      px="xs"
      py={8}
      radius={0}
      style={{
        borderBottom: "1px solid var(--lp-border)",
        background: "var(--lp-surface)",
      }}
    >
      <Stack gap={6}>
        {/* Daemon status line */}
        <Group gap={6} wrap="nowrap">
          <IconPlugConnected size={14} color="var(--lp-text-secondary)" />
          <Text size="xs" fw={500} c="dimmed">Daemon</Text>
          <Group gap={4} wrap="nowrap">
            <Box
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                backgroundColor: isOnline
                  ? "var(--mantine-color-green-6)"
                  : "var(--mantine-color-gray-6)",
                flexShrink: 0,
              }}
            />
            <Text size="xs" c={isOnline ? "green" : "dimmed"}>
              {isOnline ? "Online" : "Offline"}
            </Text>
          </Group>
        </Group>

        {/* Preview URLs or placeholder */}
        {previewUrls.length > 0 ? (
          previewUrls.map(({ projectId: pid, url }) => (
            <Group key={pid} gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>Preview:</Text>
              <Anchor
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                size="xs"
                ff="monospace"
                truncate
                style={{ flex: 1, minWidth: 0 }}
              >
                {url}
              </Anchor>
              <Tooltip label="Open preview" withArrow>
                <ActionIcon
                  component="a"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="subtle"
                  size="xs"
                  color="gray"
                >
                  <IconExternalLink size={12} />
                </ActionIcon>
              </Tooltip>
            </Group>
          ))
        ) : (
          <Text size="xs" c="dimmed" fs="italic">
            Locally running applications will appear here when detected.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
