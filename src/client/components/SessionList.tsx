import {
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Menu,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useSelectedSession } from "../contexts/SessionContext.js";
import {
  useAggregatedSessions,
  useCopilotAgentCatalog,
  useCopilotAgentPreference,
  useCreateSession,
  useDaemonForProject,
  useUpdateCopilotAgentPreference,
} from "../services/hooks.js";
import type {
  AggregatedSession,
  AggregatedSessionStatus,
  CopilotAgentCatalogEntry,
} from "../services/types.js";

const DEFAULT_SDK_AGENT_LABEL = "Default";

type CreateSessionRequest = {
  sessionType?: AggregatedSession["sessionType"];
  agentId?: string | null;
  agentName?: string | null;
  rememberAgent?: boolean;
};

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

const statusColor: Record<AggregatedSessionStatus, string> = {
  active: "green",
  idle: "yellow",
  error: "red",
  ended: "gray",
};

function sessionTypeColor(type?: string): string {
  switch (type) {
    case "copilot-cli":
      return "teal";
    case "copilot-sdk":
      return "blue";
    case "squad-sdk":
      return "violet";
    default:
      return "gray";
  }
}

function sessionTypeLabel(type?: string): string {
  switch (type) {
    case "copilot-cli":
      return "CLI";
    case "copilot-sdk":
      return "SDK";
    case "squad-sdk":
      return "Squad";
    default:
      return "SDK";
  }
}

function findAgentById(agents: CopilotAgentCatalogEntry[], agentId: string | null | undefined) {
  if (!agentId) return null;
  return agents.find((agent) => agent.id === agentId) ?? null;
}

function SessionCreateOption({
  label,
  description,
  current,
}: {
  label: string;
  description?: string;
  current?: boolean;
}) {
  return (
    <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        {description ? (
          <Text size="xs" c="dimmed" lineClamp={2}>
            {description}
          </Text>
        ) : null}
      </Stack>
      {current ? (
        <Badge size="xs" color="blue" variant="light">
          Current
        </Badge>
      ) : null}
    </Group>
  );
}

// ── Session Item ───────────────────────────────────────

function SessionItem({
  session,
  selected,
  onSelect,
}: {
  session: AggregatedSession;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton
      component="div"
      onClick={onSelect}
      p="xs"
      style={{
        borderRadius: "var(--mantine-radius-sm)",
        backgroundColor: selected ? "var(--mantine-color-blue-light)" : undefined,
        cursor: "pointer",
      }}
      w="100%"
    >
      <Group gap={6} wrap="nowrap">
        <Box
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: `var(--mantine-color-${statusColor[session.status]}-6)`,
            flexShrink: 0,
          }}
        />
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={4} wrap="nowrap">
            <Badge size="xs" color={sessionTypeColor(session.sessionType)} variant="outline">
              {sessionTypeLabel(session.sessionType)}
            </Badge>
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {timeAgo(session.updatedAt)}
            </Text>
          </Group>
          <Text size="xs" truncate fw={selected ? 600 : 400}>
            {session.summary || session.title || "Untitled session"}
          </Text>
        </Stack>
      </Group>
    </UnstyledButton>
  );
}

// ── New Session Controls ───────────────────────────────

function NewSessionControls({
  isOnline,
  isPending,
  sdkAgents,
  sdkAgentLabel,
  sdkAgentId,
  sdkAgentTooltip,
  isAgentCatalogLoading,
  onCreate,
}: {
  isOnline: boolean;
  isPending: boolean;
  sdkAgents: CopilotAgentCatalogEntry[];
  sdkAgentLabel: string;
  sdkAgentId: string | null;
  sdkAgentTooltip: string;
  isAgentCatalogLoading: boolean;
  onCreate: (request: CreateSessionRequest) => void;
}) {
  return (
    <Group gap="xs" px="xs" pt="xs" wrap="nowrap">
      <Menu shadow="md" width={300}>
        <Menu.Target>
          <Tooltip label={isOnline ? "Start a new Copilot session" : "Daemon offline"}>
            <Button
              variant="light"
              size="compact-xs"
              style={{ flex: 1 }}
              disabled={!isOnline}
              loading={isPending}
            >
              ➕ New
            </Button>
          </Tooltip>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item onClick={() => onCreate({ sessionType: "copilot-cli" })}>
            Copilot CLI
          </Menu.Item>

          <Menu.Item
            aria-label={`Create Copilot SDK session with remembered agent ${sdkAgentLabel}`}
            onClick={() =>
              onCreate({
                sessionType: "copilot-sdk",
                agentId: sdkAgentId,
                agentName: sdkAgentId ? sdkAgentLabel : null,
              })
            }
            rightSection={
              <Badge size="xs" color="blue" variant="light">
                {sdkAgentLabel}
              </Badge>
            }
          >
            Copilot SDK
          </Menu.Item>

          <Menu.Label>Switch Copilot SDK agent</Menu.Label>

          <Menu.Item
            aria-label="Create default Copilot SDK session and remember it"
            onClick={() =>
              onCreate({
                sessionType: "copilot-sdk",
                agentId: null,
                agentName: null,
                rememberAgent: true,
              })
            }
          >
            <SessionCreateOption
              label={DEFAULT_SDK_AGENT_LABEL}
              description="Plain session with no custom agent"
              current={sdkAgentId === null}
            />
          </Menu.Item>

          {isAgentCatalogLoading ? (
            <Menu.Item disabled leftSection={<Loader size="xs" />}>
              Loading agents…
            </Menu.Item>
          ) : sdkAgents.length > 0 ? (
            sdkAgents.map((agent) => (
              <Menu.Item
                key={agent.id}
                aria-label={`Create Copilot SDK session with ${agent.name} and remember it`}
                onClick={() =>
                  onCreate({
                    sessionType: "copilot-sdk",
                    agentId: agent.id,
                    agentName: agent.name,
                    rememberAgent: true,
                  })
                }
              >
                <SessionCreateOption
                  label={agent.name}
                  description={agent.description}
                  current={sdkAgentId === agent.id}
                />
              </Menu.Item>
            ))
          ) : (
            <Menu.Item disabled>No discovered agents yet</Menu.Item>
          )}

          <Menu.Divider />

          <Menu.Item onClick={() => onCreate({ sessionType: "squad-sdk" })}>Squad SDK</Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <Tooltip label={sdkAgentTooltip}>
        <Badge
          color="blue"
          variant="light"
          size="sm"
          style={{ flexShrink: 0, maxWidth: 150 }}
          styles={{
            label: {
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          }}
        >
          SDK: {sdkAgentLabel}
        </Badge>
      </Tooltip>
    </Group>
  );
}

// ── Main Component ─────────────────────────────────────

export function SessionList() {
  const { selectedProject } = useSelectedProject();
  const { selectedSession, selectSession } = useSelectedSession();

  const owner = selectedProject?.owner;
  const repo = selectedProject?.repo;
  const projectId = selectedProject ? `${owner}/${repo}` : undefined;

  const { sessions, isLoading } = useAggregatedSessions(projectId);
  const { daemon } = useDaemonForProject(projectId);
  const createSession = useCreateSession();
  const updateCopilotAgentPreference = useUpdateCopilotAgentPreference();
  const { data: copilotAgentCatalog, isLoading: isAgentCatalogLoading } = useCopilotAgentCatalog(
    owner,
    repo,
  );
  const { data: copilotAgentPreference } = useCopilotAgentPreference(owner, repo);
  const isOnline = !!daemon;

  const sdkAgents = copilotAgentCatalog?.agents ?? [];
  const rememberedAgent = findAgentById(sdkAgents, copilotAgentPreference?.agentId);
  const rememberedAgentLabel =
    rememberedAgent?.name ??
    copilotAgentPreference?.agentName ??
    copilotAgentPreference?.agentId ??
    DEFAULT_SDK_AGENT_LABEL;
  const rememberedAgentAvailable =
    !copilotAgentPreference?.agentId || !!rememberedAgent || !copilotAgentCatalog;
  const currentSdkAgentId = rememberedAgentAvailable
    ? (copilotAgentPreference?.agentId ?? null)
    : null;
  const currentSdkAgentLabel = rememberedAgentAvailable
    ? rememberedAgentLabel
    : DEFAULT_SDK_AGENT_LABEL;
  const sdkAgentTooltip =
    copilotAgentPreference?.agentId && !rememberedAgentAvailable
      ? `Saved agent ${rememberedAgentLabel} is unavailable, so new SDK sessions will use Default`
      : `Copilot SDK will start with ${currentSdkAgentLabel}`;

  const handleCreate = async ({
    sessionType,
    agentId = null,
    agentName = null,
    rememberAgent = false,
  }: CreateSessionRequest) => {
    if (!selectedProject) return;

    if (
      sessionType === "copilot-sdk" &&
      rememberAgent &&
      agentId !== (copilotAgentPreference?.agentId ?? null)
    ) {
      updateCopilotAgentPreference.mutate({
        owner: selectedProject.owner,
        repo: selectedProject.repo,
        agentId,
        agentName,
      });
    }

    const result = await createSession.mutateAsync({
      owner: selectedProject.owner,
      repo: selectedProject.repo,
      sessionType,
      agentId: sessionType === "copilot-sdk" ? agentId : undefined,
    });

    if (result.sessionId) {
      const newSession: AggregatedSession = {
        sessionId: result.sessionId,
        sessionType: (result.sessionType ?? sessionType) as AggregatedSession["sessionType"],
        status: "idle",
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      selectSession(newSession, { resume: false });
    }
  };

  if (!selectedProject) {
    return (
      <Stack gap={0} h="100%">
        <Text size="xs" fw={600} p="xs" pb={4}>
          Sessions
        </Text>
        <Stack align="center" justify="center" p="md" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed" ta="center">
            Select a project first
          </Text>
        </Stack>
      </Stack>
    );
  }

  if (isLoading) {
    return (
      <Stack gap={0} h="100%">
        <Text size="xs" fw={600} p="xs" pb={4}>
          Sessions
        </Text>
        <NewSessionControls
          isOnline={isOnline}
          isPending={createSession.isPending}
          sdkAgents={sdkAgents}
          sdkAgentLabel={currentSdkAgentLabel}
          sdkAgentId={currentSdkAgentId}
          sdkAgentTooltip={sdkAgentTooltip}
          isAgentCatalogLoading={isAgentCatalogLoading}
          onCreate={handleCreate}
        />
        <Stack align="center" justify="center" p="md" style={{ flex: 1 }}>
          <Loader size="sm" />
        </Stack>
      </Stack>
    );
  }

  if (sessions.length === 0) {
    return (
      <Stack gap={0} h="100%">
        <Text size="xs" fw={600} p="xs" pb={4}>
          Sessions
        </Text>
        <NewSessionControls
          isOnline={isOnline}
          isPending={createSession.isPending}
          sdkAgents={sdkAgents}
          sdkAgentLabel={currentSdkAgentLabel}
          sdkAgentId={currentSdkAgentId}
          sdkAgentTooltip={sdkAgentTooltip}
          isAgentCatalogLoading={isAgentCatalogLoading}
          onCreate={handleCreate}
        />
        <Stack align="center" justify="center" p="md" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed" ta="center">
            No sessions yet
          </Text>
          <Text size="xs" c="dimmed" ta="center">
            Create one to get started
          </Text>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap={0} h="100%">
      <Text size="xs" fw={600} p="xs" pb={4}>
        Sessions
      </Text>

      <NewSessionControls
        isOnline={isOnline}
        isPending={createSession.isPending}
        sdkAgents={sdkAgents}
        sdkAgentLabel={currentSdkAgentLabel}
        sdkAgentId={currentSdkAgentId}
        sdkAgentTooltip={sdkAgentTooltip}
        isAgentCatalogLoading={isAgentCatalogLoading}
        onCreate={handleCreate}
      />

      <Stack gap={2} px="xs" py="xs" style={{ flex: 1, overflowY: "auto" }}>
        {sessions.map((session) => (
          <SessionItem
            key={session.sessionId}
            session={session}
            selected={selectedSession?.sessionId === session.sessionId}
            onSelect={() =>
              selectSession(selectedSession?.sessionId === session.sessionId ? null : session)
            }
          />
        ))}
      </Stack>
    </Stack>
  );
}
