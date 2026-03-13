import { AppShell, Flex, ScrollArea, Title, Group } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ProjectList } from "../components/ProjectList";
import { KanbanBoard } from "../components/KanbanBoard";
import { SessionsPanel } from "../components/SessionsPanel";
import { ConnectionStatus } from "../components/ConnectionStatus";

export function DashboardLayout() {
  const isSmallScreen = useMediaQuery("(max-width: 768px)");

  return (
    <AppShell header={{ height: 50 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={3}>🚀 launchpad-hq</Title>
          <ConnectionStatus />
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
                : "1px solid var(--mantine-color-default-border)",
              borderBottom: isSmallScreen
                ? "1px solid var(--mantine-color-default-border)"
                : undefined,
            }}
          >
            <ProjectList />
          </ScrollArea>

          {/* Center pane — Kanban Board */}
          <ScrollArea style={{ flex: 1, minWidth: 0 }}>
            <KanbanBoard />
          </ScrollArea>

          {/* Right pane — Sessions */}
          <ScrollArea
            style={{
              width: isSmallScreen ? "100%" : 300,
              minWidth: isSmallScreen ? undefined : 300,
              borderLeft: isSmallScreen
                ? undefined
                : "1px solid var(--mantine-color-default-border)",
              borderTop: isSmallScreen
                ? "1px solid var(--mantine-color-default-border)"
                : undefined,
            }}
          >
            <SessionsPanel />
          </ScrollArea>
        </Flex>
      </AppShell.Main>
    </AppShell>
  );
}
