import { Badge, CloseButton, Group, Paper, Text, Transition } from "@mantine/core";
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
              onClick={onClose}
              data-testid="floating-close"
            />
          </Group>

          {/* Conversation body */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {isCliSession && daemon ? (
              <Terminal daemonId={daemon.daemonId} onClose={onClose} />
            ) : (
              <CopilotConversation sessionId={sessionId} sessionType={sessionData?.sessionType} onClose={onClose} />
            )}
          </div>
        </Paper>
      )}
    </Transition>
  );
}
