import {
  Stack,
  Text,
  Group,
  Badge,
  Button,
  Box,
  Image,
  Loader,
  Title,
} from "@mantine/core";
import { IconExternalLink, IconDeviceDesktop } from "@tabler/icons-react";
import { usePreviewList, usePreviewQr, buildPreviewUrl, formatDetectionSource, usePreviewWebSocket } from "../services/preview-hooks.js";
import { useTunnelStatus } from "../services/hooks.js";
import type { PreviewEntry } from "../services/types.js";

function PreviewEntryCard({ entry }: { entry: PreviewEntry }) {
  const { data: tunnel } = useTunnelStatus();
  const { data: qr, isLoading: qrLoading } = usePreviewQr(entry.projectId, true);

  const previewUrl = qr?.previewUrl ?? buildPreviewUrl(tunnel ?? undefined, entry.projectId);
  const detectionSource = formatDetectionSource(entry.detectedFrom);

  return (
    <Box
      p="sm"
      style={{
        borderRadius: "var(--mantine-radius-sm)",
        border: "1px solid var(--lp-border)",
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap">
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: "var(--mantine-color-green-6)",
                flexShrink: 0,
              }}
              aria-label="Preview active"
            />
            <Text size="sm" fw={500} truncate>
              {entry.projectId}
            </Text>
          </Group>
          <Group gap={4} mt={4}>
            <Badge size="xs" variant="light" color="blue">
              :{entry.port}
            </Badge>
            {entry.autoDetected && detectionSource && (
              <Badge size="xs" variant="light" color="teal">
                {detectionSource}
              </Badge>
            )}
            {!entry.autoDetected && (
              <Badge size="xs" variant="light" color="gray">
                Manual
              </Badge>
            )}
          </Group>
        </Box>

        {/* QR thumbnail */}
        <Box style={{ flexShrink: 0 }}>
          {qrLoading ? (
            <Loader size="xs" />
          ) : qr?.qrDataUrl ? (
            <Image
              src={qr.qrDataUrl}
              alt={`QR for ${entry.projectId}`}
              w={48}
              h={48}
              fit="contain"
              radius="xs"
              style={{ background: "white", padding: 2 }}
            />
          ) : null}
        </Box>
      </Group>

      {/* Open button — large tap target for mobile */}
      {previewUrl && (
        <Button
          component="a"
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant="light"
          size="xs"
          fullWidth
          mt="xs"
          leftSection={<IconExternalLink size={14} />}
        >
          Open
        </Button>
      )}
    </Box>
  );
}

export function PreviewPanel() {
  usePreviewWebSocket();
  const { data: previews, isLoading } = usePreviewList();

  const activePreviews = previews?.filter((p) => p.port > 0) ?? [];

  return (
    <Stack gap="xs" p="md">
      <Group gap="xs">
        <IconDeviceDesktop size={18} />
        <Title order={5}>App Previews</Title>
        {activePreviews.length > 0 && (
          <Badge size="xs" variant="filled" color="green">
            {activePreviews.length}
          </Badge>
        )}
      </Group>

      {isLoading && (
        <Stack align="center" py="md">
          <Loader size="sm" />
          <Text size="xs" c="dimmed">Loading previews…</Text>
        </Stack>
      )}

      {!isLoading && activePreviews.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          No active previews. Start a dev server in a project daemon to see previews here.
        </Text>
      )}

      {activePreviews.map((entry) => (
        <PreviewEntryCard key={entry.projectId} entry={entry} />
      ))}
    </Stack>
  );
}
