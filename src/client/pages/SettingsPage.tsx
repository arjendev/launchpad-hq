import { useEffect, useState, useCallback } from "react";
import {
  AppShell,
  Group,
  Title,
  Stack,
  Text,
  Select,
  SegmentedControl,
  Badge,
  Alert,
  Paper,
  Button,
  Divider,
  ScrollArea,
  ActionIcon,
  Tooltip,
  TextInput,
  Loader,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconArrowLeft,
  IconDatabase,
  IconRobot,
  IconBrain,
  IconWorldShare,
  IconInfoCircle,
  IconCheck,
  IconX,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import {
  useSettings,
  useUpdateSettings,
  useTunnelStatus,
  useListModels,
  useValidateRepo,
} from "../services/hooks.js";
import type { LaunchpadConfig, TunnelState } from "../services/types.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { useSubscription } from "../contexts/WebSocketContext.js";

const AVAILABLE_MODELS = [
  { value: "claude-opus-4.6", label: "Claude Opus 4.6 — best for complex tasks" },
  { value: "claude-sonnet-4.6", label: "Claude Sonnet 4.6 — faster, good balance" },
  { value: "claude-sonnet-4", label: "Claude Sonnet 4 — cost-effective, capable" },
  { value: "gpt-5.2", label: "GPT-5.2 — OpenAI, latest" },
  { value: "gpt-5.1", label: "GPT-5.1 — OpenAI, good general purpose" },
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro — Google, preview" },
];

interface SettingSectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  requiresRestart?: boolean;
}

function SettingSection({ icon, title, description, children, requiresRestart }: SettingSectionProps) {
  return (
    <Paper p="lg" withBorder>
      <Stack gap="sm">
        <Group gap="xs">
          {icon}
          <Title order={5}>{title}</Title>
          {requiresRestart && (
            <Tooltip label="Restart launchpad-hq to apply changes" withArrow>
              <Badge color="orange" variant="light" size="sm" leftSection={<IconInfoCircle size={12} />}>
                restart required
              </Badge>
            </Tooltip>
          )}
        </Group>
        <Text size="sm" c="dimmed">{description}</Text>
        {children}
      </Stack>
    </Paper>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const { data: tunnel } = useTunnelStatus();
  const { data: modelsData } = useListModels();
  const validateRepo = useValidateRepo();

  // Local form state — synced from server on load
  const [stateMode, setStateMode] = useState<string>("local");
  const [stateRepo, setStateRepo] = useState<string>("");
  const [sessionType, setSessionType] = useState<string>("sdk");
  const [defaultModel, setDefaultModel] = useState<string>("claude-opus-4.6");
  const [tunnelMode, setTunnelMode] = useState<string>("on-demand");
  const [tunnelStopped, setTunnelStopped] = useState(false);

  // Subscribe to real-time tunnel status updates via WebSocket
  const { data: wsTunnelStatus } = useSubscription<TunnelState>("tunnel");
  const liveTunnel = wsTunnelStatus ?? tunnel ?? null;

  useEffect(() => {
    if (settings) {
      setStateMode(settings.stateMode);
      setStateRepo(settings.stateRepo ?? "");
      setSessionType(settings.copilot.defaultSessionType);
      setDefaultModel(settings.copilot.defaultModel);
      setTunnelMode(settings.tunnel.mode);
    }
  }, [settings]);

  // Build model options — merge server-provided models with fallback list
  const modelOptions = modelsData?.models?.length
    ? modelsData.models.map((m) => ({ value: m.id, label: m.name || m.id }))
    : AVAILABLE_MODELS;

  function saveSetting(patch: Partial<LaunchpadConfig>) {
    updateSettings.mutate(patch);
  }

  function handleStateModeChange(value: string) {
    setStateMode(value);
    saveSetting({ stateMode: value as "local" | "git" });
  }

  const handleValidateRepo = useCallback(() => {
    if (!stateRepo.trim()) return;
    validateRepo.mutate(stateRepo.trim(), {
      onSuccess: (result) => {
        if (result.valid) {
          saveSetting({ stateRepo: stateRepo.trim() });
        }
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateRepo]);

  function handleSessionTypeChange(value: string) {
    setSessionType(value);
    saveSetting({ copilot: { defaultSessionType: value as "sdk" | "cli", defaultModel } });
  }

  function handleModelChange(value: string | null) {
    if (!value) return;
    setDefaultModel(value);
    saveSetting({ copilot: { defaultSessionType: sessionType as "sdk" | "cli", defaultModel: value } });
  }

  function handleTunnelModeChange(value: string) {
    const prev = tunnelMode;
    setTunnelMode(value);
    setTunnelStopped(false);
    saveSetting({ tunnel: { mode: value as "always" | "on-demand", configured: settings?.tunnel.configured ?? false } });
    if (prev === "always" && value === "on-demand") {
      setTunnelStopped(true);
    }
  }

  const maxWidth = isMobile ? "100%" : 640;

  return (
    <AppShell header={{ height: isMobile ? 46 : 50 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px={isMobile ? "xs" : "md"} justify="space-between">
          <Group gap="xs">
            <ActionIcon variant="subtle" onClick={() => void navigate({ to: "/" })} aria-label="Back to dashboard">
              <IconArrowLeft size={18} />
            </ActionIcon>
            <Title order={isMobile ? 4 : 3}>⚙️ Settings</Title>
          </Group>
          <ThemeToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <ScrollArea style={{ height: isMobile ? "calc(100dvh - 46px)" : "calc(100dvh - 50px)" }}>
          <Stack
            gap="md"
            p="md"
            style={{ maxWidth, margin: "0 auto" }}
          >
            {updateSettings.isError && (
              <Alert color="red" variant="light" title="Save failed">
                {updateSettings.error.message}
              </Alert>
            )}

            {updateSettings.isSuccess && (
              <Alert color="green" variant="light" title="Saved" withCloseButton onClose={() => updateSettings.reset()}>
                Settings updated successfully.
              </Alert>
            )}

            {/* ── State Mode ──────────────────────────────────── */}
            <SettingSection
              icon={<IconDatabase size={20} />}
              title="State Storage Mode"
              description="Launchpad stores your project configuration, preferences, and enrichment data. Local keeps everything on this machine (~/.launchpad/). Git syncs to a private GitHub repo (launchpad-state) across all your machines."
              requiresRestart
            >
              <SegmentedControl
                value={stateMode}
                onChange={handleStateModeChange}
                data={[
                  { value: "local", label: "🖥️ Local" },
                  { value: "git", label: "☁️ Git" },
                ]}
                disabled={isLoading}
                fullWidth
              />
              <Text size="xs" c="dimmed">
                {stateMode === "local"
                  ? "Fast & private — stored on this machine only"
                  : "Synced everywhere — requires GitHub token with repo scope"}
              </Text>
              {stateMode === "git" && (
                <>
                  <Group gap="xs" align="flex-end">
                    <TextInput
                      label="GitHub Repository"
                      placeholder="owner/repo"
                      description="The private repo to store launchpad state"
                      value={stateRepo}
                      onChange={(e) => { setStateRepo(e.currentTarget.value); validateRepo.reset(); }}
                      style={{ flex: 1 }}
                      disabled={isLoading}
                    />
                    <Button
                      variant="light"
                      onClick={handleValidateRepo}
                      loading={validateRepo.isPending}
                      disabled={!stateRepo.trim() || isLoading}
                      mb={1}
                    >
                      Validate
                    </Button>
                  </Group>
                  {validateRepo.isSuccess && validateRepo.data.valid && (
                    <Alert color="green" variant="light" icon={<IconCheck size={16} />}>
                      {validateRepo.data.message || "Repository validated — you have write access."}
                    </Alert>
                  )}
                  {validateRepo.isSuccess && !validateRepo.data.valid && (
                    <Alert color="red" variant="light" icon={<IconX size={16} />}>
                      {validateRepo.data.message || "Validation failed."}
                    </Alert>
                  )}
                  {validateRepo.isError && (
                    <Alert color="red" variant="light" icon={<IconX size={16} />}>
                      {validateRepo.error.message}
                    </Alert>
                  )}
                </>
              )}
            </SettingSection>

            {/* ── Copilot Session Preference ───────────────────── */}
            <SettingSection
              icon={<IconRobot size={20} />}
              title="Copilot Session Preference"
              description="When creating a new Copilot session from the dashboard, which mode should be the default? You can always create either type — this just sets the default."
            >
              <SegmentedControl
                value={sessionType}
                onChange={handleSessionTypeChange}
                data={[
                  { value: "sdk", label: "🧠 SDK Mode" },
                  { value: "cli", label: "💻 CLI Mode" },
                ]}
                disabled={isLoading}
                fullWidth
              />
              <Text size="xs" c="dimmed">
                {sessionType === "sdk"
                  ? "Rich agent experience — structured conversations, tool use, plan mode, full introspection"
                  : "Classic terminal — lightweight, familiar, great for quick questions and edits"}
              </Text>
            </SettingSection>

            {/* ── Default AI Model ────────────────────────────── */}
            <SettingSection
              icon={<IconBrain size={20} />}
              title="Default AI Model"
              description="Which AI model should SDK sessions use by default? You can change the model per-session from the dashboard."
            >
              <Select
                value={defaultModel}
                onChange={handleModelChange}
                data={modelOptions}
                disabled={isLoading}
                searchable
                allowDeselect={false}
              />
            </SettingSection>

            {/* ── DevTunnel ───────────────────────────────────── */}
            <SettingSection
              icon={<IconWorldShare size={20} />}
              title="Dev Tunnel Configuration"
              description="DevTunnels let you access your HQ dashboard from your phone or any browser, even outside your local network. Uses Microsoft DevTunnels with Entra ID authentication for secure access."
              requiresRestart
            >
              <Group justify="space-between">
                <Text size="sm" fw={500}>Tunnel status</Text>
                {liveTunnel?.status === "running" ? (
                  <Badge color="green" variant="light" leftSection="🟢">Running</Badge>
                ) : liveTunnel?.status === "error" ? (
                  <Badge color="red" variant="light" leftSection="🔴">Error</Badge>
                ) : liveTunnel?.status === "starting" ? (
                  <Badge color="yellow" variant="light" leftSection={<Loader size={10} />}>Starting…</Badge>
                ) : liveTunnel?.status === "stopping" ? (
                  <Badge color="yellow" variant="light" leftSection={<Loader size={10} />}>Stopping…</Badge>
                ) : (
                  <Badge color="gray" variant="light" leftSection="⚪">Not configured</Badge>
                )}
              </Group>

              {liveTunnel?.status === "running" && liveTunnel.info?.url && (
                <Alert color="green" variant="light" icon={<IconCheck size={16} />}>
                  Tunnel URL: <strong>{liveTunnel.info.url}</strong>
                </Alert>
              )}

              {liveTunnel?.status === "error" && liveTunnel.error && (
                <Alert color="red" variant="light" icon={<IconX size={16} />}>
                  {liveTunnel.error}
                </Alert>
              )}

              <Divider />

              <SegmentedControl
                value={tunnelMode}
                onChange={handleTunnelModeChange}
                data={[
                  { value: "on-demand", label: "On-demand" },
                  { value: "always", label: "Always" },
                ]}
                disabled={isLoading}
                fullWidth
              />
              <Text size="xs" c="dimmed">
                {tunnelMode === "on-demand"
                  ? "Start tunnels manually when you need them"
                  : "Auto-start a tunnel every time HQ launches"}
              </Text>
              {tunnelStopped && tunnelMode === "on-demand" && (
                <Alert color="blue" variant="light" withCloseButton onClose={() => setTunnelStopped(false)}>
                  Tunnel stopped.
                </Alert>
              )}
              {tunnelMode === "always" && !settings?.tunnel.configured && (
                <Alert color="yellow" variant="light">
                  Run <strong>devtunnel user login</strong> in your terminal to authenticate, then restart launchpad-hq.
                </Alert>
              )}
            </SettingSection>

            <Divider my="xs" />

            <Group justify="center">
              <Button variant="subtle" onClick={() => void navigate({ to: "/" })}>
                ← Back to Dashboard
              </Button>
            </Group>
          </Stack>
        </ScrollArea>
      </AppShell.Main>
    </AppShell>
  );
}
