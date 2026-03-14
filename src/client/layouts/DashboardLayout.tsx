import { useState } from "react";
import { AppShell, Flex, ScrollArea, Title, Group } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ProjectList } from "../components/ProjectList";
import { KanbanBoard } from "../components/KanbanBoard";
import { ConnectedProjectPanel } from "../components/ConnectedProjectPanel";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { ThemeToggle } from "../components/ThemeToggle";
import { FloatingConversation } from "../components/FloatingConversation";

export function DashboardLayout() {
  const isSmallScreen = useMediaQuery("(max-width: 768px)");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionType, setActiveSessionType] = useState<string | undefined>();

  return (
    <AppShell header={{ height: 50 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={3}>🚀 launchpad-hq</Title>
          <Group gap="xs">
            <ThemeToggle />
            <ConnectionStatus />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Flex
          direction={isSmallScreen ? "column" : "row"}
          style={{ height: "calc(100dvh - 50px)" }}
        >
          {/* Left pane — Projects */}
          <ScrollArea
            style={{
              width: isSmallScreen ? "100%" : 250,
              minWidth: isSmallScreen ? undefined : 250,
              borderRight: isSmallScreen
                ? undefined
                : "1px solid var(--lp-border)",
              borderBottom: isSmallScreen
                ? "1px solid var(--lp-border)"
                : undefined,
            }}
          >
            <ProjectList />
          </ScrollArea>

          {/* Center pane — Kanban Board */}
          <ScrollArea style={{ flex: 1, minWidth: 0 }}>
            <KanbanBoard />
          </ScrollArea>

          {/* Right pane — Connected Project */}
          <ScrollArea
            style={{
              width: isSmallScreen ? "100%" : 300,
              minWidth: isSmallScreen ? undefined : 300,
              borderLeft: isSmallScreen
                ? undefined
                : "1px solid var(--lp-border)",
              borderTop: isSmallScreen
                ? "1px solid var(--lp-border)"
                : undefined,
            }}
          >
            <ConnectedProjectPanel onOpenConversation={(sessionId, sessionType) => {
              setActiveSessionId(sessionId);
              setActiveSessionType(sessionType);
            }} />
          </ScrollArea>
        </Flex>
      </AppShell.Main>

      {/* Floating conversation overlay */}
      {activeSessionId && (
        <FloatingConversation
          sessionId={activeSessionId}
          sessionType={activeSessionType}
          onClose={() => {
            setActiveSessionId(null);
            setActiveSessionType(undefined);
          }}
        />
      )}
    </AppShell>
  );
}
