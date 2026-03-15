import {
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useState } from "react";
import { useSelectedProject } from "../contexts/ProjectContext.js";
import { useSelectedSession } from "../contexts/SessionContext.js";
import {
  useAggregatedSessions,
  useAvailableSdkSessions,
  useCreateSession,
  useDaemonForProject,
} from "../services/hooks.js";
import type { AggregatedSession, AggregatedSessionStatus } from "../services/types.js";
import { DEFAULT_SESSION_ACTIVITY } from "../services/types.js";
import type { SessionActivity } from "../services/types.js";
import { DaemonInfoBar } from "./DaemonInfoBar.js";

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
    case "copilot-cli": return "teal";
    case "copilot-sdk": return "blue";
    default: return "gray";
  }
}

function sessionTypeLabel(type?: string): string {
  switch (type) {
    case "copilot-cli": return "CLI";
    case "copilot-sdk": return "SDK";
    default: return "SDK";
  }
}

function getActivityPill(activity: SessionActivity | undefined): { emoji: string; label: string; color: string } | null {
  if (!activity || activity.phase === "idle") {
    if (activity?.backgroundTasks?.length) {
      return { emoji: "🔄", label: `${activity.backgroundTasks.length} bg`, color: "gray" };
    }
    return null;
  }
  const firstTool = activity.activeToolCalls[0];
  const firstSub = activity.activeSubagents[0];
  switch (activity.phase) {
    case "thinking": return { emoji: "🧠", label: "Thinking", color: "blue" };
    case "tool": return { emoji: "🔧", label: firstTool?.name ?? "Tool", color: "orange" };
    case "subagent": return { emoji: "🤖", label: firstSub?.displayName ?? firstSub?.name ?? "Agent", color: "violet" };
    case "waiting": return { emoji: "⏳", label: "Waiting", color: "yellow" };
    case "error": return { emoji: "❌", label: "Error", color: "red" };
    default: return null;
  }
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
  const activity = session.activity;
  const activityPill = getActivityPill(activity);

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
            {activityPill && (
              <Badge size="xs" color={activityPill.color} variant="light" data-testid="activity-pill">
                {activityPill.emoji} {activityPill.label}
              </Badge>
            )}
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

// ── Resume Session Modal ──────────────────────────────

function ResumeSessionModal({
  opened,
  onClose,
  onResume,
  owner,
  repo,
  trackedSessionIds,
}: {
  opened: boolean;
  onClose: () => void;
  onResume: (sessionId: string) => void;
  owner: string;
  repo: string;
  trackedSessionIds: Set<string>;
}) {
  const { data, isLoading, isError } = useAvailableSdkSessions(
    opened ? owner : undefined,
    opened ? repo : undefined,
  );

  // Filter out sessions already tracked in the aggregator
  const available = (data?.sessions ?? []).filter(
    (s) => !trackedSessionIds.has(s.sessionId),
  );

  return (
    <Modal opened={opened} onClose={onClose} title="Resume a session" size="md">
      {isLoading && (
        <Stack align="center" p="md"><Loader size="sm" /></Stack>
      )}
      {isError && (
        <Text size="sm" c="red" p="xs">Failed to load sessions from daemon</Text>
      )}
      {!isLoading && !isError && available.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" p="md">
          No additional sessions available to resume
        </Text>
      )}
      <Stack gap={4}>
        {available.map((s) => (
          <UnstyledButton
            key={s.sessionId}
            p="xs"
            style={{ borderRadius: "var(--mantine-radius-sm)" }}
            onClick={() => { onResume(s.sessionId); onClose(); }}
            w="100%"
          >
            <Group gap={6} wrap="nowrap">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text size="xs" fw={500} truncate>
                  {s.summary || s.sessionId.slice(0, 12)}
                </Text>
                <Text size="xs" c="dimmed">
                  {new Date(s.modifiedTime).toLocaleString()} · {s.sessionId.slice(0, 8)}
                </Text>
              </Stack>
            </Group>
          </UnstyledButton>
        ))}
      </Stack>
    </Modal>
  );
}

// ── Main Component ─────────────────────────────────────

export function SessionList() {
  const { selectedProject } = useSelectedProject();
  const { selectedSession, selectSession, openTerminal } = useSelectedSession();
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [sessionMode, setSessionMode] = useState<"copilot-sdk" | "copilot-cli">("copilot-sdk");

  const owner = selectedProject?.owner;
  const repo = selectedProject?.repo;
  const projectId = selectedProject ? `${owner}/${repo}` : undefined;

  const { sessions, isLoading } = useAggregatedSessions(projectId);
  const { daemon } = useDaemonForProject(projectId);
  const createSession = useCreateSession();
  const isOnline = !!daemon;

  const trackedSessionIds = new Set(sessions.map((s) => s.sessionId));

  const handleCreate = async (sessionType: AggregatedSession["sessionType"]) => {
    if (!selectedProject) return;

    const result = await createSession.mutateAsync({
      owner: selectedProject.owner,
      repo: selectedProject.repo,
      sessionType,
    });

    if (result.sessionId) {
      const newSession: AggregatedSession = {
        sessionId: result.sessionId,
        sessionType: (result.sessionType ?? sessionType) as AggregatedSession["sessionType"],
        status: "idle",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        activity: { ...DEFAULT_SESSION_ACTIVITY },
      };
      selectSession(newSession, { resume: false });
    }
  };

  const handleResume = (sessionId: string) => {
    const fakeSession: AggregatedSession = {
      sessionId,
      sessionType: "copilot-sdk",
      status: "idle",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      activity: { ...DEFAULT_SESSION_ACTIVITY },
    };
    selectSession(fakeSession);
  };

  const handleResumeLast = () => {
    // Find the most recently updated SDK session (from available sessions, not tracked)
    // For now, trigger the modal — the "Resume Last" button will use the available sessions query
    if (!owner || !repo) return;
    // Fetch and resume the most recent one
    fetch(`/api/daemons/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/copilot/sessions`)
      .then((r) => r.json())
      .then((data: { sessions?: Array<{ sessionId: string; modifiedTime: string }> }) => {
        const available = (data.sessions ?? [])
          .filter((s) => !trackedSessionIds.has(s.sessionId))
          .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());
        if (available[0]) {
          handleResume(available[0].sessionId);
        }
      })
      .catch(() => {});
  };

  if (!selectedProject) {
    return (
      <Stack gap={0} h="100%">
        <Text size="xs" fw={600} p="xs" pb={4}>Sessions</Text>
        <Stack align="center" justify="center" p="md" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed" ta="center">Select a project first</Text>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap={0} h="100%">
      <DaemonInfoBar />

      <Text size="xs" fw={600} p="xs" pb={4}>Sessions</Text>

      {/* Session type toggle + action buttons */}
      <Stack gap={4} px="xs" pt="xs">
        <SegmentedControl
          size="xs"
          value={sessionMode}
          onChange={(v) => setSessionMode(v as "copilot-sdk" | "copilot-cli")}
          data={[
            { value: "copilot-sdk", label: "SDK" },
            { value: "copilot-cli", label: "CLI" },
          ]}
          fullWidth
        />
        <Tooltip label={isOnline ? `Start a new ${sessionMode === "copilot-cli" ? "CLI" : "SDK"} session` : "Daemon offline"}>
          <Button
            variant="light"
            size="compact-xs"
            fullWidth
            disabled={!isOnline}
            loading={createSession.isPending}
            onClick={() => handleCreate(sessionMode)}
          >
            ➕ New Session
          </Button>
        </Tooltip>
        {sessionMode === "copilot-sdk" && (
          <Group gap={4} wrap="nowrap">
            <Tooltip label="Resume the most recent session">
              <Button
                variant="subtle"
                size="compact-xs"
                style={{ flex: 1 }}
                disabled={!isOnline}
                onClick={handleResumeLast}
              >
                ⏪ Continue
              </Button>
            </Tooltip>
            <Tooltip label="Pick a session to resume">
              <Button
                variant="subtle"
                size="compact-xs"
                style={{ flex: 1 }}
                disabled={!isOnline}
                onClick={() => setResumeModalOpen(true)}
              >
                📋 Pick
              </Button>
            </Tooltip>
          </Group>
        )}
        <Tooltip label={isOnline ? "Open a standalone terminal on the daemon" : "Daemon offline"}>
          <Button
            variant="subtle"
            size="compact-xs"
            fullWidth
            disabled={!isOnline}
            onClick={openTerminal}
          >
            🖥 Open Terminal
          </Button>
        </Tooltip>
      </Stack>

      {/* Active sessions list */}
      {isLoading ? (
        <Stack align="center" justify="center" p="md" style={{ flex: 1 }}>
          <Loader size="sm" />
        </Stack>
      ) : sessions.length === 0 ? (
        <Stack align="center" justify="center" p="md" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed" ta="center">No active sessions</Text>
          <Text size="xs" c="dimmed" ta="center">Create or resume one to get started</Text>
        </Stack>
      ) : (
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
      )}

      {/* Resume picker modal */}
      {owner && repo && (
        <ResumeSessionModal
          opened={resumeModalOpen}
          onClose={() => setResumeModalOpen(false)}
          onResume={handleResume}
          owner={owner}
          repo={repo}
          trackedSessionIds={trackedSessionIds}
        />
      )}
    </Stack>
  );
}
