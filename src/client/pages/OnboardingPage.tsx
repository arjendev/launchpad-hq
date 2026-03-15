import { useEffect, useState } from "react";
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
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconDatabase,
  IconRobot,
  IconBrain,
  IconWorldShare,
  IconCheck,
  IconRocket,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import {
  useSettings,
  useUpdateSettings,
  useListModels,
} from "../services/hooks.js";
import type { LaunchpadConfig } from "../services/types.js";
import { ThemeToggle } from "../components/ThemeToggle.js";

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

  const [active, setActive] = useState(0);

  // Local form state
  const [stateMode, setStateMode] = useState<string>("local");
  const [sessionType, setSessionType] = useState<string>("sdk");
  const [defaultModel, setDefaultModel] = useState<string>("claude-opus-4.6");
  const [tunnelMode, setTunnelMode] = useState<string>("on-demand");

  // Sync from server on load
  useEffect(() => {
    if (settings) {
      setStateMode(settings.stateMode);
      setSessionType(settings.copilot.defaultSessionType);
      setDefaultModel(settings.copilot.defaultModel);
      setTunnelMode(settings.tunnel.mode);
    }
  }, [settings]);

  const modelOptions = modelsData?.models?.length
    ? modelsData.models.map((m) => ({ value: m.id, label: m.name || m.id }))
    : AVAILABLE_MODELS;

  const maxWidth = isMobile ? "100%" : 640;

  function saveAndFinish() {
    const patch: Partial<LaunchpadConfig> = {
      stateMode: stateMode as "local" | "git",
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
                      onChange={setStateMode}
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
                  </Stack>
                </Paper>
              </Stepper.Step>

              {/* Step 1: Copilot Session */}
              <Stepper.Step label="Copilot" icon={<IconRobot size={18} />}>
                <Paper p="lg" withBorder mt="md">
                  <Stack gap="sm">
                    <Title order={5}>🤖 Copilot Session Preference</Title>
                    <Text size="sm" c="dimmed">
                      Default mode when creating a new Copilot session.
                      You can always create either type — this just sets the default.
                    </Text>
                    <SegmentedControl
                      value={sessionType}
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
                        ? "Rich agent experience — structured conversations, tool use, plan mode"
                        : "Classic terminal — lightweight, familiar, great for quick questions"}
                    </Text>
                  </Stack>
                </Paper>
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
                <Paper p="lg" withBorder mt="md">
                  <Stack gap="sm">
                    <Title order={5}>🌐 Dev Tunnel Configuration</Title>
                    <Text size="sm" c="dimmed">
                      DevTunnels let you access your HQ dashboard from your phone or any
                      browser, even outside your local network.
                    </Text>
                    <SegmentedControl
                      value={tunnelMode}
                      onChange={setTunnelMode}
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
                    {tunnelMode === "always" && !settings?.tunnel.configured && (
                      <Alert color="yellow" variant="light">
                        Run <strong>devtunnel user login</strong> in your terminal to authenticate,
                        then restart launchpad-hq.
                      </Alert>
                    )}
                  </Stack>
                </Paper>
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
                <Button onClick={nextStep}>
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
