import { useEffect, useState } from "react";
import { Badge, Button, CloseButton, Group, Paper, Text, Tooltip, Transition } from "@mantine/core";
import { CopilotConversation } from "./CopilotConversation.js";
import { Terminal } from "./Terminal.js";
import { useAggregatedSession, useEndSession } from "../services/hooks.js";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useDaemonForProject } from "../services/hooks.js";

export interface FloatingConversationProps {
  sessionId: string;
  sessionType?: string;
  onClose: () => void;
}

const statusColor: Record<string, string> = {
  active: "green",
  idle: "yellow",
  error: "red",
  ended: "gray",
};

const statusLabel: Record<string, string> = {
  active: "● active",
  idle: "● idle",
  error: "● error",
  ended: "● ended",
};

export function FloatingConversation({
  sessionId,
  sessionType: propSessionType,
  onClose,
}: FloatingConversationProps) {
  const { data: sessionData } = useAggregatedSession(sessionId);
  const { selectedProject } = useSelectedProject();
  const projectId = selectedProject
    ? `${selectedProject.owner}/${selectedProject.repo}`
    : null;
  const { daemon } = useDaemonForProject(projectId ?? undefined);
  const endSession = useEndSession();

  // Use prop first (immediate), fall back to query (lazy)
  const resolvedSessionType = propSessionType ?? sessionData?.sessionType;
  const isCliSession = resolvedSessionType === "copilot-cli";
  const isSdkLike = resolvedSessionType === "copilot-sdk" || resolvedSessionType === "squad-sdk";

  const [controlPanelOpen, setControlPanelOpen] = useState(false);

  const sessionStatus = sessionData?.status ?? "idle";

  const handleDetach = () => {
    if (isCliSession && sessionId) {
      fetch(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/disconnect`, {
        method: "POST",
      }).catch(() => {});
    }
    onClose();
  };

  const handleEndSession = () => {
    endSession.mutate(sessionId, {
      onSuccess: () => onClose(),
    });
  };

  // Resume SDK/Squad sessions when the overlay mounts.
  // CLI sessions handle resume inside the Terminal component after WS join.
  useEffect(() => {
    if (isCliSession || !sessionId) return;
    fetch(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});
  }, [sessionId, isCliSession]);

  return (
    <Transition mounted transition="slide-up" duration={250} timingFunction="ease">
      {(styles) => (
        <Paper
          shadow="xl"
          radius="md"
          withBorder
          style={{
            ...styles,
            position: "fixed",
            bottom: 16,
            right: 16,
            width: "66vw",
            height: "66vh",
            zIndex: 200,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <Group
            justify="space-between"
            px="sm"
            py={6}
            style={{
              borderBottom: "1px solid var(--mantine-color-default-border)",
              flexShrink: 0,
            }}
          >
            <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
              <Tooltip label={sessionData?.summary ?? sessionId} openDelay={400}>
                <Text size="sm" fw={600} truncate>
                  Session — {sessionData?.summary ?? sessionData?.title ?? sessionId.slice(0, 8)}
                </Text>
              </Tooltip>
              {resolvedSessionType && (
                <Badge size="xs" variant="outline" color={
                  resolvedSessionType === "copilot-cli" ? "teal"
                    : resolvedSessionType === "squad-sdk" ? "violet"
                    : "blue"
                }>
                  {resolvedSessionType === "copilot-cli" ? "CLI"
                    : resolvedSessionType === "squad-sdk" ? "Squad"
                    : "SDK"}
                </Badge>
              )}
            </Group>
            <Group gap={4} wrap="nowrap">
              <Badge
                size="xs"
                variant="dot"
                color={statusColor[sessionStatus] ?? "gray"}
              >
                {statusLabel[sessionStatus] ?? sessionStatus}
              </Badge>
              {isSdkLike && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setControlPanelOpen((o) => !o)}
                  data-testid="control-panel-toggle"
                >
                  ⚙️
                </Button>
              )}
              <Tooltip label="Detach (hide session)">
                <CloseButton
                  size="sm"
                  aria-label="Detach"
                  onClick={handleDetach}
                  data-testid="floating-close"
                />
              </Tooltip>
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                onClick={handleEndSession}
                loading={endSession.isPending}
                data-testid="end-session-button"
              >
                🛑 End
              </Button>
            </Group>
          </Group>

          {/* Conversation body */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {isCliSession && daemon ? (
              <Terminal daemonId={daemon.daemonId} terminalId={sessionId} onClose={handleDetach} />
            ) : (
              <CopilotConversation sessionId={sessionId} sessionType={resolvedSessionType} controlPanelOpen={controlPanelOpen} />
            )}
          </div>
        </Paper>
      )}
    </Transition>
  );
}
