import { useState } from "react";
import { AppShell, Flex, ScrollArea, Stack, Text, Title, Group } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ProjectList } from "../components/ProjectList.js";
import { SessionList } from "../components/SessionList.js";
import { BacklogList } from "../components/BacklogList.js";
import { InboxPanel } from "../components/InboxPanel.js";
import { ResizableTerminalPanel } from "../components/ResizableTerminalPanel.js";
import { ConnectionStatus } from "../components/ConnectionStatus.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { TunnelButton } from "../components/TunnelButton.js";
import { MobileNavBar } from "../components/MobileNavBar.js";
import type { MobileTab } from "../components/MobileNavBar.js";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useSelectedSession } from "../contexts/SessionContext.js";
import { useDaemonForProject, useInboxCount } from "../services/hooks.js";

export function DashboardLayout() {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [mobileTab, setMobileTab] = useState<MobileTab>("projects");
  const { selectedProject } = useSelectedProject();
  const { selectedSession, selectSession } = useSelectedSession();

  const projectId = selectedProject
    ? `${selectedProject.owner}/${selectedProject.repo}`
    : undefined;
  const { daemon } = useDaemonForProject(projectId);
  const { data: inboxData } = useInboxCount(
    selectedProject?.owner,
    selectedProject?.repo,
  );

  // ── Desktop layout ────────────────────────────────────
  if (!isMobile) {
    return (
      <AppShell header={{ height: 50 }} padding={0}>
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Title order={3}>🚀 launchpad-hq</Title>
            <Group gap="xs">
              <TunnelButton />
              <ThemeToggle />
              <ConnectionStatus />
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Main>
          <Flex direction="row" style={{ height: "calc(100dvh - 50px)" }}>
            {/* Column 1 — Projects (250px) */}
            <ScrollArea
              style={{
                width: 250,
                minWidth: 250,
                borderRight: "1px solid var(--lp-border)",
              }}
            >
              <ProjectList />
            </ScrollArea>

            {/* Column 2 — Sessions (220px) */}
            <div
              style={{
                width: 220,
                minWidth: 220,
                borderRight: "1px solid var(--lp-border)",
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
                <Stack align="center" justify="center" style={{ flex: 1 }}>
                  <Text size="lg" c="dimmed">
                    Select a project to get started
                  </Text>
                </Stack>
              ) : (
                <>
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

                  {selectedSession && daemon && (
                    <ResizableTerminalPanel
                      daemonId={daemon.daemonId}
                      sessionId={selectedSession.sessionId}
                      sessionType={selectedSession.sessionType}
                      terminalId={selectedSession.sessionId}
                      onClose={() => selectSession(null)}
                      defaultHeight={Math.floor(
                        (window.innerHeight - 50) * 0.7,
                      )}
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

  // ── Mobile layout ─────────────────────────────────────
  const showTerminal = !!selectedSession && !!daemon;

  return (
    <AppShell header={{ height: 46 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="xs" justify="space-between">
          <Title order={4}>🚀 launchpad</Title>
          <Group gap={4}>
            <TunnelButton />
            <ThemeToggle />
            <ConnectionStatus />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <div
          style={{
            height: "calc(100dvh - 46px)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Active panel */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {showTerminal ? (
              <ResizableTerminalPanel
                daemonId={daemon.daemonId}
                sessionId={selectedSession.sessionId}
                sessionType={selectedSession.sessionType}
                terminalId={selectedSession.sessionId}
                onClose={() => selectSession(null)}
                defaultHeight={window.innerHeight - 46 - 52}
                minHeight={200}
              />
            ) : (
              <>
                {mobileTab === "projects" && (
                  <ScrollArea style={{ height: "100%" }}>
                    <ProjectList />
                  </ScrollArea>
                )}
                {mobileTab === "sessions" && (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                    }}
                  >
                    <SessionList />
                  </div>
                )}
                {mobileTab === "board" && (
                  <ScrollArea style={{ height: "100%" }}>
                    {!selectedProject ? (
                      <Stack align="center" justify="center" p="xl">
                        <Text size="sm" c="dimmed">
                          Select a project first
                        </Text>
                      </Stack>
                    ) : (
                      <Stack gap={0}>
                        <InboxPanel />
                        <div
                          style={{
                            borderTop: "1px solid var(--lp-border)",
                          }}
                        >
                          <BacklogList />
                        </div>
                      </Stack>
                    )}
                  </ScrollArea>
                )}
              </>
            )}
          </div>

          {/* Bottom nav */}
          <MobileNavBar
            activeTab={mobileTab}
            onTabChange={setMobileTab}
            unreadCount={inboxData?.unread}
          />
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
