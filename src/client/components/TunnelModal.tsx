import {
  Modal,
  Stack,
  Text,
  Button,
  Group,
  Image,
  CopyButton,
  ActionIcon,
  Tooltip,
  Loader,
  Alert,
} from "@mantine/core";
import { IconCopy, IconCheck, IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import { useTunnelStatus, useTunnelQr, useStartTunnel, useStopTunnel } from "../services/hooks.js";

interface TunnelModalProps {
  opened: boolean;
  onClose: () => void;
}

export function TunnelModal({ opened, onClose }: TunnelModalProps) {
  const { data: tunnel } = useTunnelStatus();
  const isRunning = tunnel?.status === "running";
  const isTransitioning = tunnel?.status === "starting" || tunnel?.status === "stopping";
  const hasError = tunnel?.status === "error";

  const { data: qr, isLoading: qrLoading } = useTunnelQr(isRunning && opened);
  const startMutation = useStartTunnel();
  const stopMutation = useStopTunnel();
  const handleStart = () => startMutation.mutate();
  const handleStop = () => stopMutation.mutate();

  const shareUrl = qr?.shareUrl ?? tunnel?.shareUrl;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Dev Tunnel"
      centered
      size="sm"
    >
      <Stack gap="md">
        {/* Error state */}
        {(hasError || startMutation.isError || stopMutation.isError) && (
          <Alert color="red" variant="light" title="Tunnel Error">
            {tunnel?.error ??
              startMutation.error?.message ??
              stopMutation.error?.message ??
              "Unknown error"}
          </Alert>
        )}

        {/* Stopped state */}
        {(!tunnel || tunnel.status === "stopped" || hasError) && !isTransitioning && (
          <Stack align="center" gap="sm" py="md">
            <IconPlugConnectedX size={48} color="var(--lp-text-secondary)" stroke={1.2} />
            <Text size="sm" c="dimmed" ta="center">
              Start a dev tunnel to access this dashboard from your phone or
              another device.
            </Text>
            <Button
              onClick={handleStart}
              loading={startMutation.isPending}
              leftSection={<IconPlugConnected size={16} />}
            >
              Start Tunnel
            </Button>
          </Stack>
        )}

        {/* Transitioning state */}
        {isTransitioning && (
          <Stack align="center" gap="sm" py="lg">
            <Loader size="md" />
            <Text size="sm" c="dimmed">
              {tunnel?.status === "starting" ? "Starting tunnel…" : "Stopping tunnel…"}
            </Text>
          </Stack>
        )}

        {/* Running state — QR code */}
        {isRunning && (
          <Stack align="center" gap="md">
            {qrLoading ? (
              <Stack align="center" gap="xs" py="md">
                <Loader size="md" />
                <Text size="sm" c="dimmed">Loading QR code…</Text>
              </Stack>
            ) : qr?.qrDataUrl ? (
              <>
                <Text size="sm" fw={500}>
                  Scan to open on your phone
                </Text>
                <Image
                  src={qr.qrDataUrl}
                  alt="Tunnel QR Code"
                  w={220}
                  h={220}
                  fit="contain"
                  radius="md"
                  style={{ background: "white", padding: 8 }}
                />
              </>
            ) : null}

            {/* Copyable URL */}
            {shareUrl && (
              <Group gap="xs" wrap="nowrap" style={{ maxWidth: "100%" }}>
                <Text
                  size="xs"
                  ff="monospace"
                  c="dimmed"
                  truncate
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {shareUrl}
                </Text>
                <CopyButton value={shareUrl} timeout={2000}>
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

            <Button
              variant="light"
              color="red"
              size="xs"
              onClick={handleStop}
              loading={stopMutation.isPending}
              leftSection={<IconPlugConnectedX size={14} />}
            >
              Stop Tunnel
            </Button>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
