import { AppShell, Flex, ScrollArea, Stack, Text, Title, Group } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ProjectList } from "../components/ProjectList.js";
import { SessionList } from "../components/SessionList.js";
import { BacklogList } from "../components/BacklogList.js";
import { InboxPanel } from "../components/InboxPanel.js";
import { ResizableTerminalPanel } from "../components/ResizableTerminalPanel.js";
import { ConnectionStatus } from "../components/ConnectionStatus.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useSelectedSession } from "../contexts/SessionContext.js";
import { useDaemonForProject } from "../services/hooks.js";

export function DashboardLayout() {
  const isSmallScreen = useMediaQuery("(max-width: 768px)");
  const { selectedProject } = useSelectedProject();
  const { selectedSession, selectSession } = useSelectedSession();

  const projectId = selectedProject
    ? `${selectedProject.owner}/${selectedProject.repo}`
    : undefined;
  const { daemon } = useDaemonForProject(projectId);

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
          {/* Column 1 — Projects (250px) */}
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

          {/* Column 2 — Sessions (220px) */}
          <div
            style={{
              width: isSmallScreen ? "100%" : 220,
              minWidth: isSmallScreen ? undefined : 220,
              borderRight: isSmallScreen
                ? undefined
                : "1px solid var(--lp-border)",
              borderBottom: isSmallScreen
                ? "1px solid var(--lp-border)"
                : undefined,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <SessionList />
          </div>

          {/* Column 3 — Main area (flex) */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {!selectedProject ? (
              /* Empty state — no project selected */
              <Stack align="center" justify="center" style={{ flex: 1 }}>
                <Text size="lg" c="dimmed">
                  Select a project to get started
                </Text>
              </Stack>
            ) : (
              <>
                {/* Top — Inbox + Backlog side by side */}
                <Flex style={{ flex: 1, minHeight: 0 }}>
                  <div
                    style={{
                      width: 250,
                      minWidth: 250,
                      borderRight: "1px solid var(--lp-border)",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <InboxPanel />
                  </div>
                  <ScrollArea style={{ flex: 1, minHeight: 0 }}>
                    <BacklogList />
                  </ScrollArea>
                </Flex>

                {/* Bottom — Terminal panel (visible when session selected) */}
                {selectedSession && daemon && (
                  <ResizableTerminalPanel
                    daemonId={daemon.daemonId}
                    sessionId={selectedSession.sessionId}
                    sessionType={selectedSession.sessionType}
                    terminalId={selectedSession.sessionId}
                    onClose={() => selectSession(null)}
                    defaultHeight={Math.floor((window.innerHeight - 50) * 0.7)}
                  />
                )}
              </>
            )}
          </div>
        </Flex>
      </AppShell.Main>
    </AppShell>
  );
}
