import { useState } from "react";
import {
  Modal,
  Button,
  Group,
  Stack,
  Text,
  Alert,
  Code,
  CopyButton,
  ActionIcon,
  Box,
  Tabs,
  Loader,
  Stepper,
} from "@mantine/core";
import { useAddProject } from "../services/hooks.js";
import { RepoSearchPicker } from "./RepoSearchPicker.js";

interface AddProjectWizardProps {
  opened: boolean;
  onClose: () => void;
}

// ── Step 2: Daemon setup instructions ──────────────────────────────

function DaemonSetup({
  owner,
  repo,
  token,
  onDone,
}: {
  owner: string;
  repo: string;
  token: string;
  onDone: () => void;
}) {
  const cliCommand = `npx launchpad-hq --daemon --hq-url ws://localhost:3000 --token ${token} --project-id ${owner}/${repo}`;

  const devcontainerSnippet = JSON.stringify(
    {
      postStartCommand: `npx launchpad-hq --daemon --hq-url ws://localhost:3000 --token ${token} --project-id ${owner}/${repo}`,
    },
    null,
    2,
  );

  return (
    <Stack gap="md">
      <Alert color="green" variant="light">
        <Text size="sm">
          Project <strong>{owner}/{repo}</strong> added successfully!
        </Text>
      </Alert>

      <Text size="sm">
        Every project needs a <strong>daemon</strong> running in the repository
        folder to connect to HQ. Choose a deployment mode:
      </Text>

      <Tabs defaultValue="manual">
        <Tabs.List>
          <Tabs.Tab value="manual">Run Daemon Manually</Tabs.Tab>
          <Tabs.Tab value="devcontainer">
            Devcontainer (Recommended)
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="manual" pt="sm">
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Run this command in your project directory:
            </Text>
            <Box pos="relative">
              <Code block style={{ fontSize: "var(--mantine-font-size-xs)" }}>
                {cliCommand}
              </Code>
              <CopyButton value={cliCommand}>
                {({ copied, copy }) => (
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={copy}
                    pos="absolute"
                    top={8}
                    right={8}
                    title={copied ? "Copied!" : "Copy to clipboard"}
                  >
                    {copied ? "✓" : "📋"}
                  </ActionIcon>
                )}
              </CopyButton>
            </Box>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="devcontainer" pt="sm">
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Add this to your <Code>devcontainer.json</Code> to auto-start the
              daemon:
            </Text>
            <Box pos="relative">
              <Code block style={{ fontSize: "var(--mantine-font-size-xs)" }}>
                {devcontainerSnippet}
              </Code>
              <CopyButton value={devcontainerSnippet}>
                {({ copied, copy }) => (
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={copy}
                    pos="absolute"
                    top={8}
                    right={8}
                    title={copied ? "Copied!" : "Copy to clipboard"}
                  >
                    {copied ? "✓" : "📋"}
                  </ActionIcon>
                )}
              </CopyButton>
            </Box>
            <Alert color="blue" variant="light">
              <Text size="xs">
                The daemon token is shown only once. Save the command before
                closing this dialog.
              </Text>
            </Alert>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <Group justify="flex-end" mt="xs">
        <Button onClick={onDone} size="xs">
          Done
        </Button>
      </Group>
    </Stack>
  );
}

// ── Main Wizard ────────────────────────────────────────────────────

export function AddProjectWizard({
  opened,
  onClose,
}: AddProjectWizardProps) {
  const [step, setStep] = useState(0);
  const [createdProject, setCreatedProject] = useState<{
    owner: string;
    repo: string;
    token: string;
  } | null>(null);

  const addProject = useAddProject();

  const resetAndClose = () => {
    setStep(0);
    setCreatedProject(null);
    addProject.reset();
    onClose();
  };

  const handleSelectRepo = (owner: string, repo: string) => {
    addProject.mutate(
      { owner, repo },
      {
        onSuccess: (data) => {
          setCreatedProject({
            owner,
            repo,
            token: data.daemonToken ?? "",
          });
          setStep(1);
        },
      },
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={resetAndClose}
      title={step === 0 ? "Add Project" : "Daemon Setup"}
      size="md"
    >
      <Stepper
        active={step}
        size="xs"
        mb="md"
        allowNextStepsSelect={false}
      >
        <Stepper.Step label="Select repo" />
        <Stepper.Step label="Daemon setup" />
      </Stepper>

      {step === 0 && (
        <Stack gap="sm">
          {addProject.isError && (
            <Alert color="red" variant="light">
              <Text size="sm">{addProject.error.message}</Text>
            </Alert>
          )}

          {addProject.isPending && (
            <Alert color="blue" variant="light">
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm">Adding project…</Text>
              </Group>
            </Alert>
          )}

          <RepoSearchPicker onSelect={handleSelectRepo} showTracked />
        </Stack>
      )}

      {step === 1 && createdProject && (
        <DaemonSetup
          owner={createdProject.owner}
          repo={createdProject.repo}
          token={createdProject.token}
          onDone={resetAndClose}
        />
      )}
    </Modal>
  );
}
