import { Paper, Group, Stack, Text, Anchor, ActionIcon, Box, Badge, Tooltip } from "@mantine/core";
import { IconExternalLink, IconPlugConnected } from "@tabler/icons-react";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useDaemonForProject, useTunnelStatus } from "../services/hooks.js";
import { usePreviewList, buildPreviewUrl, buildLocalPreviewUrl, formatDetectionSource } from "../services/preview-hooks.js";

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

        {/* Preview entries or placeholder */}
        {projectPreviews.length > 0 ? (
          projectPreviews.map((preview) => {
            const localUrl = buildLocalPreviewUrl(preview.projectId);
            const tunnelUrl = buildPreviewUrl(tunnel ?? undefined, preview.projectId);
            const source = formatDetectionSource(preview.detectedFrom);

            return (
              <Stack key={preview.projectId} gap={4}>
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>Preview:</Text>
                  <Badge size="xs" variant="light" color="blue">
                    Port {preview.port}{source ? ` (${source})` : ""}
                  </Badge>
                  <Anchor
                    href={localUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="xs"
                    fw={500}
                  >
                    Open Preview
                  </Anchor>
                  <Tooltip label="Open preview in new tab" withArrow>
                    <ActionIcon
                      component="a"
                      href={localUrl}
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
                {tunnelUrl && (
                  <Group gap={4} wrap="nowrap" style={{ minWidth: 0, paddingLeft: 20 }}>
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>Tunnel:</Text>
                    <Anchor
                      href={tunnelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="xs"
                      ff="monospace"
                      truncate
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {tunnelUrl}
                    </Anchor>
                  </Group>
                )}
              </Stack>
            );
          })
        ) : (
          <Text size="xs" c="dimmed" fs="italic">
            Locally running applications will appear here when detected.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
