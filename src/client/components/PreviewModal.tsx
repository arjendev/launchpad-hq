import {
  Modal,
  Stack,
  Text,
  Button,
  Group,
  Image,
  Badge,
  Code,
  Loader,
  Anchor,
  CopyButton,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import { IconExternalLink, IconCopy, IconCheck } from "@tabler/icons-react";
import { usePreviewState, usePreviewQr, buildPreviewUrl, formatDetectionSource } from "../services/preview-hooks.js";
import { useTunnelStatus } from "../services/hooks.js";

interface PreviewModalProps {
  projectId: string;
  projectName: string;
  opened: boolean;
  onClose: () => void;
}

export function PreviewModal({ projectId, projectName, opened, onClose }: PreviewModalProps) {
  const { data: preview } = usePreviewState(opened ? projectId : null);
  const { data: qr, isLoading: qrLoading } = usePreviewQr(projectId, opened);
  const { data: tunnel } = useTunnelStatus();

  const previewUrl = qr?.previewUrl ?? buildPreviewUrl(tunnel ?? undefined, projectId);
  const detectionSource = formatDetectionSource(preview?.detectedFrom);

  const portLabel = preview
    ? `Port ${preview.port}${preview.autoDetected && detectionSource ? ` (auto-detected from ${detectionSource})` : preview.autoDetected ? " (auto-detected)" : " (manual config)"}`
    : null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Preview — ${projectName}`}
      centered
      size="sm"
    >
      <Stack gap="md">
        {/* Port info */}
        {portLabel && (
          <Group gap="xs">
            <Text size="sm" c="dimmed">{portLabel}</Text>
            {preview?.autoDetected && detectionSource && (
              <Badge size="xs" variant="light" color="teal">
                {detectionSource}
              </Badge>
            )}
          </Group>
        )}

        {/* QR Code */}
        <Stack align="center" gap="sm">
          {qrLoading ? (
            <Stack align="center" gap="xs" py="md">
              <Loader size="md" />
              <Text size="sm" c="dimmed">Loading QR code…</Text>
            </Stack>
          ) : qr?.qrDataUrl ? (
            <>
              <Text size="sm" fw={500}>Scan to open on your phone</Text>
              <Image
                src={qr.qrDataUrl}
                alt="Preview QR Code"
                w={220}
                h={220}
                fit="contain"
                radius="md"
                style={{ background: "white", padding: 8 }}
              />
            </>
          ) : null}
        </Stack>

        {/* Preview URL */}
        {previewUrl && (
          <Group gap="xs" wrap="nowrap" style={{ maxWidth: "100%" }}>
            <Code
              style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {previewUrl}
            </Code>
            <CopyButton value={previewUrl} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Copied!" : "Copy URL"} withArrow>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    color={copied ? "teal" : "gray"}
                    onClick={copy}
                  >
                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
        )}

        {/* Open in new tab */}
        {previewUrl && (
          <Anchor href={previewUrl} target="_blank" rel="noopener noreferrer" underline="never">
            <Button
              variant="light"
              fullWidth
              leftSection={<IconExternalLink size={16} />}
            >
              Open in new tab
            </Button>
          </Anchor>
        )}
      </Stack>
    </Modal>
  );
}
