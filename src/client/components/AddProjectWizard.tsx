import { useState } from "react";
import {
  Modal,
  TextInput,
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
  Avatar,
  UnstyledButton,
  Badge,
  Loader,
  ScrollArea,
  Stepper,
} from "@mantine/core";
import {
  useAddProject,
  useDiscoverUsers,
  useDiscoverRepos,
} from "../services/hooks.js";
import type { DiscoverUser, DiscoverRepo } from "../services/types.js";

interface AddProjectWizardProps {
  opened: boolean;
  onClose: () => void;
}

/** Debounce delay for search inputs (ms). */
const DEBOUNCE_MS = 350;

// ── Step 1: Owner search → Repo selection ──────────────────────────

function OwnerSearch({
  onSelect,
}: {
  onSelect: (user: DiscoverUser) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (val: string) => {
    setQuery(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    setDebounceTimer(
      setTimeout(() => setDebouncedQuery(val.trim()), DEBOUNCE_MS),
    );
  };

  const { data, isLoading } = useDiscoverUsers(debouncedQuery);
  const users = data?.users ?? [];

  return (
    <Stack gap="xs">
      <TextInput
        label="Search GitHub users or organizations"
        placeholder="Type a username or org…"
        value={query}
        onChange={(e) => handleChange(e.currentTarget.value)}
        data-autofocus
        rightSection={isLoading ? <Loader size="xs" /> : null}
      />
      {users.length > 0 && (
        <ScrollArea.Autosize mah={260}>
          <Stack gap={4}>
            {users.map((u) => (
              <UnstyledButton
                key={u.login}
                onClick={() => onSelect(u)}
                p="xs"
                style={{
                  borderRadius: "var(--mantine-radius-sm)",
                  border: "1px solid var(--lp-border)",
                }}
              >
                <Group gap="sm" wrap="nowrap">
                  <Avatar src={u.avatarUrl} size="sm" radius="xl" />
                  <div>
                    <Text size="sm" fw={500}>
                      {u.login}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {u.type}
                    </Text>
                  </div>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
      {debouncedQuery.length >= 2 && !isLoading && users.length === 0 && (
        <Text size="sm" c="dimmed" ta="center">
          No users found
        </Text>
      )}
    </Stack>
  );
}

function RepoList({
  owner,
  onSelect,
  onBack,
}: {
  owner: DiscoverUser;
  onSelect: (repo: DiscoverRepo) => void;
  onBack: () => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (val: string) => {
    setSearch(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    setDebounceTimer(
      setTimeout(() => setDebouncedSearch(val.trim()), DEBOUNCE_MS),
    );
  };

  const { data, isLoading } = useDiscoverRepos(owner.login, debouncedSearch || undefined);
  const repos = data?.repos ?? [];

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Button variant="subtle" size="compact-xs" onClick={onBack}>
          ← Back
        </Button>
        <Group gap="xs" wrap="nowrap">
          <Avatar src={owner.avatarUrl} size="xs" radius="xl" />
          <Text size="sm" fw={500}>
            {owner.login}
          </Text>
        </Group>
      </Group>

      <TextInput
        placeholder="Filter repositories…"
        value={search}
        onChange={(e) => handleChange(e.currentTarget.value)}
        rightSection={isLoading ? <Loader size="xs" /> : null}
      />

      {isLoading && repos.length === 0 && (
        <Stack align="center" py="md">
          <Loader size="sm" />
        </Stack>
      )}

      {repos.length > 0 && (
        <ScrollArea.Autosize mah={300}>
          <Stack gap={4}>
            {repos.map((r) => (
              <UnstyledButton
                key={r.fullName}
                onClick={() => !r.tracked && onSelect(r)}
                p="xs"
                style={{
                  borderRadius: "var(--mantine-radius-sm)",
                  border: "1px solid var(--lp-border)",
                  opacity: r.tracked ? 0.5 : 1,
                  cursor: r.tracked ? "not-allowed" : "pointer",
                }}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={500} truncate>
                        {r.repo}
                      </Text>
                      {r.private && (
                        <Badge size="xs" variant="light" color="gray">
                          private
                        </Badge>
                      )}
                      {r.tracked && (
                        <Badge size="xs" variant="filled" color="blue">
                          tracked
                        </Badge>
                      )}
                    </Group>
                    {r.description && (
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {r.description}
                      </Text>
                    )}
                  </Box>
                  {r.language && (
                    <Text size="xs" c="dimmed">
                      {r.language}
                    </Text>
                  )}
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}

      {!isLoading && repos.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          No repositories found
        </Text>
      )}
    </Stack>
  );
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
  const [selectedOwner, setSelectedOwner] = useState<DiscoverUser | null>(null);
  const [createdProject, setCreatedProject] = useState<{
    owner: string;
    repo: string;
    token: string;
  } | null>(null);

  const addProject = useAddProject();

  const resetAndClose = () => {
    setStep(0);
    setSelectedOwner(null);
    setCreatedProject(null);
    addProject.reset();
    onClose();
  };

  const handleSelectRepo = (repo: DiscoverRepo) => {
    addProject.mutate(
      { owner: repo.owner, repo: repo.repo },
      {
        onSuccess: (data) => {
          setCreatedProject({
            owner: repo.owner,
            repo: repo.repo,
            token: data.daemonToken ?? "",
          });
          setStep(1);
        },
      },
    );
  };

  const handleSelectOwner = (user: DiscoverUser) => {
    setSelectedOwner(user);
  };

  const handleBackToSearch = () => {
    setSelectedOwner(null);
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

          {selectedOwner ? (
            <RepoList
              owner={selectedOwner}
              onSelect={handleSelectRepo}
              onBack={handleBackToSearch}
            />
          ) : (
            <OwnerSearch onSelect={handleSelectOwner} />
          )}
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
