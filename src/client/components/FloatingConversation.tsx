import { CloseButton, Group, Paper, Text, Transition } from "@mantine/core";
import { CopilotConversation } from "./CopilotConversation.js";

export interface FloatingConversationProps {
  sessionId: string;
  onClose: () => void;
}

export function FloatingConversation({
  sessionId,
  onClose,
}: FloatingConversationProps) {
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
            <Text size="sm" fw={600} truncate style={{ flex: 1 }}>
              Session {sessionId.slice(0, 8)}
            </Text>
            <CloseButton
              size="sm"
              aria-label="Close conversation"
              onClick={onClose}
              data-testid="floating-close"
            />
          </Group>

          {/* Conversation body */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <CopilotConversation sessionId={sessionId} onClose={onClose} />
          </div>
        </Paper>
      )}
    </Transition>
  );
}
