import {
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useSelectedSession } from "../contexts/SessionContext.js";
import type { AggregatedSession } from "../services/types.js";
import { DEFAULT_SESSION_ACTIVITY } from "../services/types.js";
import {
  useCoordinatorStatus,
  useStartCoordinator,
  useStopCoordinator,
  useResetCoordinator,
} from "../services/workflow-hooks.js";
import type { CoordinatorStatus } from "../services/workflow-types.js";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1_000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const coordinatorDotColor: Record<CoordinatorStatus, string> = {
  idle: "gray",
  starting: "yellow",
  active: "green",
  crashed: "red",
};

export function CoordinatorCard({ owner, repo }: { owner: string; repo: string }) {
  const { coordinator, isLoading } = useCoordinatorStatus(owner, repo);
  const { selectedSession, selectSession } = useSelectedSession();
  const startCoordinator = useStartCoordinator();
  const stopCoordinator = useStopCoordinator();
  const resetCoordinator = useResetCoordinator();

  const status: CoordinatorStatus = coordinator?.status ?? "idle";
  const dotColor = coordinatorDotColor[status];
  const isPulsing = status === "starting";
  const isRunning = status === "active" || status === "starting";

  const activeCount = coordinator?.activeDispatches?.filter(
    (d) => d.status === "pending" || d.status === "running",
  ).length ?? 0;

  const handleStartStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning) {
      stopCoordinator.mutate({ owner, repo });
    } else {
      startCoordinator.mutate({ owner, repo });
    }
  };

  const coordinatorSessionId = coordinator?.sessionId;
  const isAttached = !!(coordinatorSessionId && selectedSession?.sessionId === coordinatorSessionId);

  const handleClick = () => {
    if (!coordinatorSessionId) return;
    if (isAttached) {
      selectSession(null);
    } else {
      const syntheticSession: AggregatedSession = {
        sessionId: coordinatorSessionId,
        sessionType: "copilot-sdk",
        status: status === "active" ? "active" : status === "starting" ? "active" : "idle",
        startedAt: coordinator?.startedAt ? new Date(coordinator.startedAt).getTime() : Date.now(),
        updatedAt: Date.now(),
        activity: DEFAULT_SESSION_ACTIVITY,
      };
      selectSession(syntheticSession);
    }
  };

  const uptime = coordinator?.startedAt ? timeAgo(new Date(coordinator.startedAt).getTime()) : null;

  if (isLoading) {
    return (
      <Box px="xs" py={6}>
        <Loader size="xs" />
      </Box>
    );
  }

  return (
    <UnstyledButton
      component="div"
      onClick={handleClick}
      px="xs"
      py={6}
      style={{
        borderRadius: "var(--mantine-radius-sm)",
        border: isAttached
          ? "1px solid var(--mantine-color-violet-6)"
          : "1px solid var(--mantine-color-default-border)",
        backgroundColor: isAttached ? "var(--mantine-color-violet-light)" : undefined,
        cursor: coordinatorSessionId ? "pointer" : "default",
      }}
      w="100%"
    >
      <Group gap={6} wrap="nowrap">
        {/* Status dot */}
        <Box
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: `var(--mantine-color-${dotColor}-6)`,
            flexShrink: 0,
            animation: isPulsing ? "lp-pulse 1.5s ease-in-out infinite" : undefined,
          }}
        />

        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          {/* First row: badge + dispatch count */}
          <Group gap={4} wrap="nowrap" justify="space-between">
            <Group gap={4} wrap="nowrap">
              <Badge size="xs" color="violet" variant="light">
                🤖 Autonomous
              </Badge>
            </Group>
            {isRunning && activeCount > 0 && (
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                {activeCount} dispatched
              </Text>
            )}
          </Group>

          {/* Second row: uptime/status + action buttons (same line) */}
          <Group gap={4} wrap="nowrap" justify="space-between">
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
              {status === "active" && uptime ? `▶ ${uptime}` : null}
              {status === "starting" ? "⏳ Starting…" : null}
              {status === "idle" ? "⏸ Idle" : null}
              {status === "crashed" ? "💥 Crashed" : null}
            </Text>
            <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
              {coordinatorSessionId && (
                <Tooltip label={isAttached ? "Detach" : "Attach"}>
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    color={isAttached ? "violet" : "gray"}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleClick(); }}
                    px={4}
                  >
                    {isAttached ? "⏏" : "👁"}
                  </Button>
                </Tooltip>
              )}
              <Tooltip label="New session">
                <Button
                  variant="subtle"
                  size="compact-xs"
                  color="orange"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    resetCoordinator.mutate({ owner, repo });
                  }}
                  loading={resetCoordinator.isPending}
                  px={4}
                >
                  🔄
                </Button>
              </Tooltip>
              <Tooltip label={isRunning ? "Stop" : "Start"}>
                <Button
                  variant="subtle"
                  size="compact-xs"
                  color={isRunning ? "red" : "green"}
                  onClick={handleStartStop}
                  loading={startCoordinator.isPending || stopCoordinator.isPending}
                  px={4}
                >
                  {isRunning ? "⏹" : "▶"}
                </Button>
              </Tooltip>
            </Group>
          </Group>
        </Stack>
      </Group>

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes lp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </UnstyledButton>
  );
}
