import { Badge, CloseButton, Group, Paper, Text, Transition } from "@mantine/core";
import { useEffect } from "react";
import { CopilotConversation } from "./CopilotConversation.js";
import { Terminal } from "./Terminal.js";
import { useAggregatedSession } from "../services/hooks.js";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useDaemonForProject } from "../services/hooks.js";

export interface FloatingConversationProps {
  sessionId: string;
  onClose: () => void;
}

export function FloatingConversation({
  sessionId,
  onClose,
}: FloatingConversationProps) {
  const { data: sessionData } = useAggregatedSession(sessionId);
  const { selectedProject } = useSelectedProject();
  const projectId = selectedProject
    ? `${selectedProject.owner}/${selectedProject.repo}`
    : null;
  const { daemon } = useDaemonForProject(projectId ?? undefined);
  const isCliSession = sessionData?.sessionType === "copilot-cli";

  // Resume CLI session on attach (replays any buffered output)
  useEffect(() => {
    if (!isCliSession || !sessionId) return;
    fetch(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/resume`, {
      method: "POST",
    }).catch(() => {});
  }, [isCliSession, sessionId]);

  const handleClose = () => {
    if (isCliSession && sessionId) {
      // Tell daemon to buffer output while detached
      fetch(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/disconnect`, {
        method: "POST",
      }).catch(() => {});
    }
    onClose();
  };

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
              <Text size="sm" fw={600} truncate>
                Session {sessionId.slice(0, 8)}
              </Text>
              {sessionData?.sessionType && (
                <Badge size="xs" variant="outline" color={
                  sessionData.sessionType === "copilot-cli" ? "teal"
                    : sessionData.sessionType === "squad-sdk" ? "violet"
                    : "blue"
                }>
                  {sessionData.sessionType === "copilot-cli" ? "CLI"
                    : sessionData.sessionType === "squad-sdk" ? "Squad"
                    : "SDK"}
                </Badge>
              )}
            </Group>
            <CloseButton
              size="sm"
              aria-label="Close conversation"
              onClick={handleClose}
              data-testid="floating-close"
            />
          </Group>

          {/* Conversation body */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {isCliSession && daemon ? (
              <Terminal daemonId={daemon.daemonId} terminalId={sessionId} onClose={handleClose} />
            ) : (
              <CopilotConversation sessionId={sessionId} sessionType={sessionData?.sessionType} onClose={handleClose} />
            )}
          </div>
        </Paper>
      )}
    </Transition>
  );
}
