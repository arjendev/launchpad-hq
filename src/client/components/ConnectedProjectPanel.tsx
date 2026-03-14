import { useState } from "react";
import {
  Accordion,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import {
  useDaemonForProject,
  useAggregatedSessions,
  useCreateSession,
  useResumeSession,
  useAttentionItems,
  useAttentionCount,
  useDismissAttention,
} from "../services/hooks.js";
import type {
  AggregatedSession,
  AggregatedSessionStatus,
  AttentionItem,
  AttentionSeverity,
  DashboardProject,
} from "../services/types.js";
import { TerminalOverlay } from "./TerminalOverlay.js";

// ── Helpers ────────────────────────────────────────────

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

function timeAgoIso(iso: string): string {
  return timeAgo(new Date(iso).getTime());
}

const RUNTIME_TARGET_LABELS: Record<string, string> = {
  "wsl-devcontainer": "WSL+DC",
  wsl: "WSL",
  local: "Local",
};

const sessionStatusColor: Record<AggregatedSessionStatus, string> = {
  active: "green",
  idle: "yellow",
  error: "red",
  ended: "gray",
};

function sessionTypeColor(type?: string): string {
  switch (type) {
    case "copilot-cli": return "teal";
    case "copilot-sdk": return "blue";
    case "squad-sdk": return "violet";
    default: return "gray";
  }
}

function sessionTypeLabel(type?: string): string {
  switch (type) {
    case "copilot-cli": return "CLI";
    case "copilot-sdk": return "SDK";
    case "squad-sdk": return "Squad";
    default: return "SDK";
  }
}

const severityColor: Record<AttentionSeverity, string> = {
  info: "blue",
  warning: "yellow",
  critical: "red",
};

// ── No Project Selected ────────────────────────────────

function NoProjectSelected() {
  return (
    <Stack align="center" justify="center" p="xl" gap="sm" style={{ minHeight: 200 }}>
      <Text size="lg" c="dimmed">
        📂
      </Text>
      <Text size="sm" c="dimmed" ta="center">
        No project selected
      </Text>
      <Text size="xs" c="dimmed" ta="center">
        Click a project in the sidebar to view details
      </Text>
    </Stack>
  );
}

// ── Daemon Status Section ──────────────────────────────

function DaemonStatusSection({ project }: { project: DashboardProject }) {
  const projectId = `${project.owner}/${project.repo}`;
  const { daemon, isLoading } = useDaemonForProject(projectId);

  if (isLoading) {
    return (
      <Stack align="center" p="sm">
        <Loader size="sm" />
      </Stack>
    );
  }

  const isOnline = !!daemon;

  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap="xs">
        <Group gap="xs">
          <ThemeIcon
            size="xs"
            radius="xl"
            color={isOnline ? "green" : "gray"}
            variant="filled"
          >
            <Box w={6} h={6} style={{ borderRadius: "50%" }} />
          </ThemeIcon>
          <Text size="sm" fw={600}>
            Daemon: {isOnline ? "Online" : "Offline"}
          </Text>
        </Group>

        <Group gap={4}>
          <Badge size="xs" variant="light" color="grape">
            {RUNTIME_TARGET_LABELS[project.runtimeTarget] ?? project.runtimeTarget}
          </Badge>
          {isOnline && project.workState && (
            <Badge size="xs" variant="light" color="blue">
              {project.workState}
            </Badge>
          )}
        </Group>

        {isOnline && daemon && (
          <Text size="xs" c="dimmed">
            Last seen: {timeAgo(daemon.lastHeartbeat)}
          </Text>
        )}

        {isOnline && daemon?.version && (
          <Text size="xs" c="dimmed">
            v{daemon.version}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

// ── Resume Session Modal ───────────────────────────────

function ResumeSessionModal({
  opened,
  onClose,
  sessions,
  onResume,
  isPending,
}: {
  opened: boolean;
  onClose: () => void;
  sessions: AggregatedSession[];
  onResume: (sessionId: string) => void;
  isPending: boolean;
}) {
  const resumable = sessions.filter((s) => s.status === "idle" || s.status === "ended");

  return (
    <Modal opened={opened} onClose={onClose} title="Resume Session" size="md">
      {resumable.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center" p="md">
          No idle or ended sessions available to resume
        </Text>
      ) : (
        <Stack gap="xs">
          {resumable.map((s) => (
            <Paper
              key={s.sessionId}
              withBorder
              p="xs"
              radius="sm"
              style={{ cursor: "pointer" }}
              onClick={() => onResume(s.sessionId)}
            >
              <Group gap="xs" wrap="nowrap">
                <Badge size="xs" color={sessionStatusColor[s.status]} variant="dot">
                  {s.status}
                </Badge>
                <Badge size="xs" color={sessionTypeColor(s.sessionType)} variant="outline">
                  {sessionTypeLabel(s.sessionType)}
                </Badge>
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>
                    {s.summary || s.title || "Untitled"}
                  </Text>
                  <Group gap="xs">
                    <Text size="xs" c="dimmed">
                      Started: {timeAgo(s.startedAt)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Updated: {timeAgo(s.updatedAt)}
                    </Text>
                  </Group>
                </Stack>
              </Group>
            </Paper>
          ))}
          {isPending && (
            <Stack align="center" p="xs">
              <Loader size="sm" />
            </Stack>
          )}
        </Stack>
      )}
    </Modal>
  );
}

function CopilotSessionsSection({
  project,
  onSelectSession,
}: {
  project: DashboardProject;
  onSelectSession?: (sessionId: string, sessionType?: string) => void;
}) {
  const projectId = `${project.owner}/${project.repo}`;
  const { sessions } = useAggregatedSessions(projectId);
  const { daemon } = useDaemonForProject(projectId);
  const createSession = useCreateSession();
  const resumeSession = useResumeSession();
  const isOnline = !!daemon;
  const [resumeModalOpen, setResumeModalOpen] = useState(false);

  const handleCreate = async (sessionType?: string) => {
    const result = await createSession.mutateAsync({
      owner: project.owner,
      repo: project.repo,
      sessionType,
    });
    if (result.sessionId) {
      onSelectSession?.(result.sessionId, result.sessionType ?? sessionType);
    }
  };

  const handleResume = (sessionId: string) => {
    const session = sessions.find((s) => s.sessionId === sessionId);
    resumeSession.mutate(
      { sessionId },
      {
        onSuccess: () => {
          setResumeModalOpen(false);
          onSelectSession?.(sessionId, session?.sessionType);
        },
      },
    );
  };

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Menu shadow="md" width={200}>
          <Menu.Target>
            <Tooltip label={isOnline ? "Start a new Copilot session" : "Daemon offline"}>
              <Button
                variant="light"
                size="xs"
                style={{ flex: 1 }}
                disabled={!isOnline}
                loading={createSession.isPending}
              >
                ➕ New Session
              </Button>
            </Tooltip>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => handleCreate("copilot-sdk")}>
              SDK Session
            </Menu.Item>
            <Menu.Item onClick={() => handleCreate("copilot-cli")}>
              CLI Terminal
            </Menu.Item>
            <Menu.Item onClick={() => handleCreate("squad-sdk")}>
              Squad Session
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Tooltip label="Resume an idle or ended session">
          <Button
            variant="light"
            size="xs"
            style={{ flex: 1 }}
            disabled={!isOnline}
            onClick={() => setResumeModalOpen(true)}
          >
            ▶️ Resume
          </Button>
        </Tooltip>
      </Group>

      <ResumeSessionModal
        opened={resumeModalOpen}
        onClose={() => setResumeModalOpen(false)}
        sessions={sessions}
        onResume={handleResume}
        isPending={resumeSession.isPending}
      />
    </Stack>
  );
}

// ── Terminal Section ───────────────────────────────────

function TerminalSection({ project }: { project: DashboardProject }) {
  const projectId = `${project.owner}/${project.repo}`;
  const { daemon } = useDaemonForProject(projectId);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const isOnline = !!daemon;

  return (
    <>
      <Tooltip label={isOnline ? "Open a terminal in this project's environment" : "Daemon offline"}>
        <Button
          variant="light"
          size="xs"
          fullWidth
          disabled={!isOnline}
          onClick={() => setTerminalOpen(true)}
        >
          Open Terminal
        </Button>
      </Tooltip>
      {isOnline && (
        <TerminalOverlay
          daemonId={daemon.daemonId}
          isOpen={terminalOpen}
          onClose={() => setTerminalOpen(false)}
        />
      )}
    </>
  );
}

// ── Attention Section ──────────────────────────────────

function AttentionItemCard({ item }: { item: AttentionItem }) {
  const dismiss = useDismissAttention();

  return (
    <Paper withBorder p="xs" radius="sm">
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <ThemeIcon
          size="xs"
          radius="xl"
          color={severityColor[item.severity]}
          variant="filled"
          mt={2}
        >
          <Box w={6} h={6} style={{ borderRadius: "50%" }} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" lineClamp={2}>
            {item.message}
          </Text>
          <Group gap={4}>
            <Badge size="xs" color={severityColor[item.severity]} variant="light">
              {item.severity}
            </Badge>
            <Text size="xs" c="dimmed">
              {item.project}
            </Text>
            <Text size="xs" c="dimmed">
              {timeAgoIso(item.createdAt)}
            </Text>
          </Group>
        </Stack>
        <Tooltip label="Dismiss">
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => dismiss.mutate(item.id)}
            loading={dismiss.isPending}
          >
            ✕
          </Button>
        </Tooltip>
      </Group>
    </Paper>
  );
}

function AttentionSection() {
  const { data, isLoading, isError } = useAttentionItems();
  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <Stack align="center" p="sm">
        <Loader size="sm" />
      </Stack>
    );
  }

  if (isError) {
    return (
      <Text size="sm" c="red" p="xs">
        Failed to load attention items
      </Text>
    );
  }

  if (items.length === 0) {
    return (
      <Text size="sm" c="dimmed" p="xs" ta="center">
        All clear — no items need attention
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {items.map((item) => (
        <AttentionItemCard key={item.id} item={item} />
      ))}
    </Stack>
  );
}

// ── Attention Badge ────────────────────────────────────

function AttentionBadge() {
  const { data } = useAttentionCount();
  if (!data || data.total === 0) return null;
  return (
    <Badge size="sm" color="red" variant="filled" ml={4}>
      {data.total}
    </Badge>
  );
}

// ── Main Panel ─────────────────────────────────────────

export function ConnectedProjectPanel({
  onOpenConversation,
}: {
  onOpenConversation?: (sessionId: string, sessionType?: string) => void;
}) {
  const { selectedProject } = useSelectedProject();

  if (!selectedProject) {
    return (
      <Stack gap={0} p="sm">
        <Title order={4} mb="sm">
          Connected Project
        </Title>
        <NoProjectSelected />
      </Stack>
    );
  }

  return (
    <Stack gap={0} p="sm">
      <Title order={4} mb="sm">
        Connected Project
      </Title>

      <Text size="sm" fw={600} mb="xs">
        {selectedProject.owner}/{selectedProject.repo}
      </Text>

      <DaemonStatusSection project={selectedProject} />

      <Divider
        my="sm"
        label="Copilot Sessions"
        labelPosition="center"
      />
      <CopilotSessionsSection
        project={selectedProject}
        onSelectSession={onOpenConversation}
      />

      <Divider my="sm" label="Terminal" labelPosition="center" />
      <TerminalSection project={selectedProject} />

      <Divider my="sm" />

      <Accordion
        multiple
        defaultValue={["attention"]}
        variant="separated"
        styles={{
          content: { padding: "var(--mantine-spacing-xs)" },
          control: { padding: "var(--mantine-spacing-xs)" },
        }}
      >
        <Accordion.Item value="attention">
          <Accordion.Control>
            <Group gap={0}>
              <Text size="sm" fw={600}>
                🔔 Attention
              </Text>
              <AttentionBadge />
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <AttentionSection />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
