import { useEffect, useMemo, useState } from "react";
import {
  AppShell,
  Group,
  Title,
  Stack,
  Text,
  Select,
  SegmentedControl,
  Alert,
  Paper,
  Button,
  Stepper,
  ScrollArea,
  TextInput,
  Loader,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconDatabase,
  IconRobot,
  IconBrain,
  IconWorldShare,
  IconCheck,
  IconRocket,
  IconX,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import {
  useSettings,
  useUpdateSettings,
  useListModels,
  useValidateRepo,
  useTunnelStatus,
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

export function OnboardingPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const { data: modelsData } = useListModels();
  const validateRepo = useValidateRepo();
  const { data: tunnel } = useTunnelStatus();
  const { data: wsTunnelStatus } = useSubscription<TunnelState>("tunnel");

  const [active, setActive] = useState(0);

  // Local form state
  const [stateMode, setStateMode] = useState<string>("local");
  const [stateRepoOwner, setStateRepoOwner] = useState<string>("");
  const [stateRepoName, setStateRepoName] = useState<string>("");
  const [sessionType, setSessionType] = useState<string>("sdk");
  const [defaultModel, setDefaultModel] = useState<string>("claude-opus-4.6");
  const [tunnelMode, setTunnelMode] = useState<string>("on-demand");
  const [tunnelBootstrapping, setTunnelBootstrapping] = useState(false);
  const [tunnelResult, setTunnelResult] = useState<{ url?: string; error?: string } | null>(null);

  const liveTunnel = wsTunnelStatus ?? tunnel ?? null;
  const sessionTypeValue = useMemo(
    () => (sessionType === "cli" ? "cli" : "sdk"),
    [sessionType],
  );

  // Sync from server on load
  useEffect(() => {
    if (settings) {
      setStateMode(settings.stateMode);
      if (settings.stateRepo) {
        const [owner, repo] = settings.stateRepo.split("/", 2);
        setStateRepoOwner(owner ?? "");
        setStateRepoName(repo ?? "");
      }
      setSessionType(settings.copilot.defaultSessionType);
      setDefaultModel(settings.copilot.defaultModel);
      setTunnelMode(settings.tunnel.mode);
    }
  }, [settings]);

  useEffect(() => {
    if (tunnelMode !== "always") return;

    if (liveTunnel?.status === "running" && liveTunnel.info?.url) {
      const runningUrl = liveTunnel.info.url;
      setTunnelBootstrapping(false);
      setTunnelResult((current) =>
        current?.url === runningUrl ? current : { url: runningUrl },
      );
      return;
    }

    if (liveTunnel?.status === "error" && liveTunnel.error) {
      const tunnelError = liveTunnel.error;
      setTunnelBootstrapping(false);
      setTunnelResult((current) =>
        current?.error === tunnelError ? current : { error: tunnelError },
      );
    }
  }, [liveTunnel, tunnelMode]);

  const modelOptions = modelsData?.models?.length
    ? modelsData.models.map((m) => ({ value: m.id, label: m.name || m.id }))
    : AVAILABLE_MODELS;

  const maxWidth = isMobile ? "100%" : 640;

  const fullRepo = stateRepoOwner && stateRepoName
    ? `${stateRepoOwner.trim()}/${stateRepoName.trim()}`
    : "";

  function handleValidateRepo() {
    if (!fullRepo || !fullRepo.includes("/")) return;
    validateRepo.mutate(fullRepo);
  }

  // Can proceed from step 0 only if local, or git with validated repo
  const canProceedFromStorage =
    stateMode === "local" ||
    (stateMode === "git" && validateRepo.isSuccess && validateRepo.data?.valid === true);

  function handleTunnelModeChange(value: string) {
    setTunnelMode(value);
    setTunnelResult(null);

    if (value === "always") {
      // If tunnel is already running, show URL immediately without bootstrapping flash
      if (liveTunnel?.status === "running" && liveTunnel.info?.url) {
        setTunnelResult({ url: liveTunnel.info.url });
        const patch: Partial<LaunchpadConfig> = {
          tunnel: {
            mode: "always",
            configured: settings?.tunnel.configured ?? false,
          },
        };
        updateSettings.mutate(patch);
        return;
      }

      // Immediately attempt to bootstrap the tunnel
      setTunnelBootstrapping(true);
      const patch: Partial<LaunchpadConfig> = {
        tunnel: {
          mode: "always",
          configured: settings?.tunnel.configured ?? false,
        },
      };
      updateSettings.mutate(patch, {
        onSuccess: (data) => {
          setTunnelBootstrapping(false);
          const tunnelStatus = (data as unknown as Record<string, unknown>).tunnelStatus as
            | { status: string; info?: { url?: string } | null; error?: string | null }
            | undefined;
          if (tunnelStatus?.status === "running" && tunnelStatus.info?.url) {
            setTunnelResult({ url: tunnelStatus.info.url });
          } else if (tunnelStatus?.error) {
            setTunnelResult({ error: tunnelStatus.error });
          }
        },
        onError: (err) => {
          setTunnelBootstrapping(false);
          setTunnelResult({ error: err.message });
        },
      });
    }
  }

  function saveAndFinish() {
    const patch: Partial<LaunchpadConfig> = {
      stateMode: stateMode as "local" | "git",
      ...(stateMode === "git" && fullRepo ? { stateRepo: fullRepo } : {}),
      copilot: {
        defaultSessionType: sessionType as "sdk" | "cli",
        defaultModel,
      },
      tunnel: {
        mode: tunnelMode as "always" | "on-demand",
        configured: settings?.tunnel.configured ?? false,
      },
      onboardingComplete: true,
    };
    updateSettings.mutate(patch, {
      onSuccess: () => void navigate({ to: "/" }),
    });
  }

  const nextStep = () => setActive((c) => Math.min(c + 1, 4));
  const prevStep = () => setActive((c) => Math.max(c - 1, 0));

  return (
    <AppShell header={{ height: isMobile ? 46 : 50 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px={isMobile ? "xs" : "md"} justify="space-between">
          <Group gap="xs">
            <IconRocket size={22} />
            <Title order={isMobile ? 4 : 3}>Setup Wizard</Title>
          </Group>
          <ThemeToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <ScrollArea style={{ height: isMobile ? "calc(100dvh - 46px)" : "calc(100dvh - 50px)" }}>
          <Stack gap="md" p="md" style={{ maxWidth, margin: "0 auto" }}>

            {updateSettings.isError && (
              <Alert color="red" variant="light" title="Save failed">
                {updateSettings.error.message}
              </Alert>
            )}

            <Stepper active={active} onStepClick={setActive} size={isMobile ? "xs" : "sm"}>
              {/* Step 0: State Storage */}
              <Stepper.Step label="Storage" icon={<IconDatabase size={18} />}>
                <Paper p="lg" withBorder mt="md">
                  <Stack gap="sm">
                    <Title order={5}>📦 State Storage Mode</Title>
                    <Text size="sm" c="dimmed">
                      Choose where Launchpad stores configuration and enrichment data.
                      Local keeps everything on this machine. Git syncs to a private GitHub repo.
                    </Text>
                    <SegmentedControl
                      value={stateMode}
                      onChange={(v) => { setStateMode(v); validateRepo.reset(); setTunnelResult(null); }}
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
                        <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
                          Launchpad uses your GitHub CLI authentication (<code>gh auth login</code>) to
                          access the state repository. Make sure you&apos;re logged in before selecting this option.
                        </Alert>
                        <Group gap="xs" grow>
                          <TextInput
                            label="GitHub Owner / Org"
                            placeholder="your-username"
                            value={stateRepoOwner}
                            onChange={(e) => { setStateRepoOwner(e.currentTarget.value); validateRepo.reset(); }}
                            disabled={isLoading}
                          />
                          <TextInput
                            label="Repository Name"
                            placeholder="launchpad-state"
                            value={stateRepoName}
                            onChange={(e) => { setStateRepoName(e.currentTarget.value); validateRepo.reset(); }}
                            disabled={isLoading}
                          />
                        </Group>
                        <Button
                          variant="light"
                          onClick={handleValidateRepo}
                          loading={validateRepo.isPending}
                          disabled={!stateRepoOwner.trim() || !stateRepoName.trim() || isLoading}
                          fullWidth
                        >
                          Validate Repository
                        </Button>
                        {validateRepo.isSuccess && validateRepo.data.valid && (
                          <Alert color="green" variant="light" icon={<IconCheck size={16} />}>
                            Repository validated — you have write access.
                          </Alert>
                        )}
                        {validateRepo.isSuccess && !validateRepo.data.valid && (
                          <Alert color="red" variant="light" icon={<IconX size={16} />}>
                            {validateRepo.data.error || "Validation failed."}
                          </Alert>
                        )}
                        {validateRepo.isError && (
                          <Alert color="red" variant="light" icon={<IconX size={16} />}>
                            {validateRepo.error.message}
                          </Alert>
                        )}
                      </>
                    )}
                  </Stack>
                </Paper>
              </Stepper.Step>

              {/* Step 1: Copilot Session */}
              <Stepper.Step label="Copilot" icon={<IconRobot size={18} />}>
                {active === 1 && (
                <Paper p="lg" withBorder mt="md">
                  <Stack gap="sm">
                    <Title order={5}>🤖 Copilot Session Preference</Title>
                    <Text size="sm" c="dimmed">
                      Default mode when creating a new Copilot session.
                      You can always create either type of session later — this just sets the default.
                    </Text>
                    <SegmentedControl
                      key={`copilot-session-${settings?.copilot.defaultSessionType ?? sessionTypeValue}`}
                      value={sessionTypeValue}
                      onChange={setSessionType}
                      data={[
                        { value: "sdk", label: "🧠 SDK Mode" },
                        { value: "cli", label: "💻 CLI Mode" },
                      ]}
                      disabled={isLoading}
                      fullWidth
                    />
                    <Text size="xs" c="dimmed">
                      {sessionType === "sdk"
                        ? "Better integration with HQ — structured conversations, tool use, plan mode, session introspection, and real-time activity streaming in the dashboard"
                        : "Standalone terminal experience — classic copilot-in-the-terminal, familiar for devs who prefer raw CLI interaction"}
                    </Text>
                  </Stack>
                </Paper>
                )}
              </Stepper.Step>

              {/* Step 2: AI Model */}
              <Stepper.Step label="Model" icon={<IconBrain size={18} />}>
                <Paper p="lg" withBorder mt="md">
                  <Stack gap="sm">
                    <Title order={5}>🎯 Default AI Model</Title>
                    <Text size="sm" c="dimmed">
                      Which AI model should SDK sessions use by default?
                      You can change the model per-session from the dashboard.
                    </Text>
                    <Select
                      value={defaultModel}
                      onChange={(v) => v && setDefaultModel(v)}
                      data={modelOptions}
                      disabled={isLoading}
                      searchable
                      allowDeselect={false}
                    />
                  </Stack>
                </Paper>
              </Stepper.Step>

              {/* Step 3: Dev Tunnel */}
              <Stepper.Step label="Tunnel" icon={<IconWorldShare size={18} />}>
                {active === 3 && (
                <Paper p="lg" withBorder mt="md">
                  <Stack gap="sm">
                    <Title order={5}>🌐 Dev Tunnel Configuration</Title>
                    <Text size="sm" c="dimmed">
                      DevTunnels let you access your HQ dashboard from your phone or any
                      browser, even outside your local network.
                    </Text>
                    <SegmentedControl
                      value={tunnelMode}
                      onChange={handleTunnelModeChange}
                      data={[
                        { value: "on-demand", label: "On-demand" },
                        { value: "always", label: "Always" },
                      ]}
                      disabled={isLoading || tunnelBootstrapping}
                      fullWidth
                    />
                    <Text size="xs" c="dimmed">
                      {tunnelMode === "on-demand"
                        ? "Start tunnels manually when you need them"
                        : "Auto-start a tunnel every time HQ launches"}
                    </Text>
                    {tunnelBootstrapping && (
                      <Alert color="blue" variant="light" icon={<Loader size={16} />}>
                        Starting tunnel…
                      </Alert>
                    )}
                    {tunnelResult?.url && (
                      <Alert color="green" variant="light" icon={<IconCheck size={16} />}>
                        Tunnel running! URL: <strong>{tunnelResult.url}</strong>
                      </Alert>
                    )}
                    {!tunnelBootstrapping && !tunnelResult && tunnelMode === "always" && liveTunnel?.status === "running" && liveTunnel.info?.url && (
                      <Alert color="green" variant="light" icon={<IconCheck size={16} />}>
                        Tunnel running! URL: <strong>{liveTunnel.info.url}</strong>
                      </Alert>
                    )}
                    {tunnelResult?.error && (
                      <Alert color="yellow" variant="light" icon={<IconX size={16} />}>
                        {tunnelResult.error.toLowerCase().includes("auth") ||
                         tunnelResult.error.toLowerCase().includes("login") ||
                         tunnelResult.error.toLowerCase().includes("credentials")
                          ? "DevTunnel requires authentication. Run `devtunnel user login` in your terminal, then try again."
                          : tunnelResult.error}
                      </Alert>
                    )}
                  </Stack>
                </Paper>
                )}
              </Stepper.Step>

              {/* Completed state */}
              <Stepper.Completed>
                <Paper p="lg" withBorder mt="md">
                  <Stack gap="sm" align="center">
                    <IconCheck size={48} color="var(--mantine-color-green-6)" />
                    <Title order={4}>All set!</Title>
                    <Text size="sm" c="dimmed" ta="center">
                      Your preferences are ready. Click finish to save and return to the dashboard.
                    </Text>
                  </Stack>
                </Paper>
              </Stepper.Completed>
            </Stepper>

            {/* Navigation buttons */}
            <Group justify="center" mt="md">
              {active > 0 && active <= 4 && (
                <Button variant="default" onClick={prevStep}>
                  ← Back
                </Button>
              )}
              {active < 4 && (
                <Button
                  onClick={nextStep}
                  disabled={active === 0 && !canProceedFromStorage}
                >
                  Next →
                </Button>
              )}
              {active === 4 && (
                <Button
                  color="green"
                  onClick={saveAndFinish}
                  loading={updateSettings.isPending}
                >
                  ✅ Finish Setup
                </Button>
              )}
            </Group>
          </Stack>
        </ScrollArea>
      </AppShell.Main>
    </AppShell>
  );
}
