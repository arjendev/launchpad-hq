import { useState } from "react";
import {
  Modal,
  TextInput,
  Button,
  Group,
  Stack,
  Text,
  Alert,
  Select,
  Code,
  CopyButton,
  ActionIcon,
  Box,
} from "@mantine/core";
import { useAddProject } from "../services/hooks.js";

interface AddProjectDialogProps {
  opened: boolean;
  onClose: () => void;
}

const RUNTIME_OPTIONS = [
  { value: "wsl-devcontainer", label: "WSL + Devcontainer" },
  { value: "wsl", label: "WSL" },
  { value: "local", label: "Local Folder" },
];

export function AddProjectDialog({ opened, onClose }: AddProjectDialogProps) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [runtimeTarget, setRuntimeTarget] = useState<string>("wsl-devcontainer");
  const [createdToken, setCreatedToken] = useState<{ token: string; owner: string; repo: string } | null>(null);
  const addProject = useAddProject();

  const handleSubmit = () => {
    if (!owner.trim() || !repo.trim()) return;
    addProject.mutate(
      { owner: owner.trim(), repo: repo.trim(), runtimeTarget },
      {
        onSuccess: (data) => {
          const token = data.daemonToken;
          if (token) {
            setCreatedToken({ token, owner: owner.trim(), repo: repo.trim() });
          } else {
            resetAndClose();
          }
        },
      },
    );
  };

  const resetAndClose = () => {
    setOwner("");
    setRepo("");
    setRuntimeTarget("wsl-devcontainer");
    setCreatedToken(null);
    addProject.reset();
    onClose();
  };

  // After project creation, show the daemon config snippet
  if (createdToken) {
    const configSnippet = [
      `LAUNCHPAD_HQ_URL=ws://localhost:4321`,
      `LAUNCHPAD_DAEMON_TOKEN=${createdToken.token}`,
      `LAUNCHPAD_PROJECT_ID=${createdToken.owner}/${createdToken.repo}`,
    ].join("\n");

    return (
      <Modal opened={opened} onClose={resetAndClose} title="Project Added" size="md">
        <Stack gap="sm">
          <Alert color="green" variant="light">
            <Text size="sm">
              Project <strong>{createdToken.owner}/{createdToken.repo}</strong> added successfully.
            </Text>
          </Alert>

          <Text size="sm" fw={500}>
            Daemon configuration (save this — the token is shown only once):
          </Text>

          <Box pos="relative">
            <Code block>{configSnippet}</Code>
            <CopyButton value={configSnippet}>
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

          <Group justify="flex-end" mt="xs">
            <Button onClick={resetAndClose} size="xs">
              Done
            </Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  return (
    <Modal opened={opened} onClose={resetAndClose} title="Add Project" size="sm">
      <Stack gap="sm">
        {addProject.isError && (
          <Alert color="red" variant="light">
            <Text size="sm">{addProject.error.message}</Text>
          </Alert>
        )}
        <TextInput
          label="Owner"
          placeholder="github-username-or-org"
          value={owner}
          onChange={(e) => setOwner(e.currentTarget.value)}
          data-autofocus
        />
        <TextInput
          label="Repository"
          placeholder="repo-name"
          value={repo}
          onChange={(e) => setRepo(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
        />
        <Select
          label="Runtime Target"
          data={RUNTIME_OPTIONS}
          value={runtimeTarget}
          onChange={(v) => setRuntimeTarget(v ?? "wsl-devcontainer")}
        />
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={resetAndClose} size="xs">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={addProject.isPending}
            disabled={!owner.trim() || !repo.trim()}
            size="xs"
          >
            Add
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
