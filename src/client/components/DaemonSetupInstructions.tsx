import {
  Stack,
  Text,
  Alert,
  Code,
  CopyButton,
  ActionIcon,
  Box,
  Tabs,
} from "@mantine/core";

interface DaemonSetupInstructionsProps {
  owner: string;
  repo: string;
  token: string;
  /** Optional warning banner shown above the instructions */
  warning?: string;
}

export function DaemonSetupInstructions({
  owner,
  repo,
  token,
  warning,
}: DaemonSetupInstructionsProps) {
  const hqPort = window.location.port || "4321";
  const daemonArgs = `--daemon --hq-url ws://localhost:${hqPort} --token ${token} --project-id ${owner}/${repo}`;
  const npxCommand = `npx github:arjendev/launchpad-hq ${daemonArgs}`;
  const windowsCommand = `launchpad-hq ${daemonArgs}`;

  const devcontainerSnippet = JSON.stringify(
    {
      postStartCommand: `npx github:arjendev/launchpad-hq ${daemonArgs}`,
    },
    null,
    2,
  );

  return (
    <Stack gap="md">
      {warning && (
        <Alert color="orange" variant="light">
          <Text size="sm">{warning}</Text>
        </Alert>
      )}

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
            <Tabs defaultValue="unix" variant="pills" radius="xl">
              <Tabs.List mb="xs">
                <Tabs.Tab value="unix" size="xs">Linux / macOS / WSL</Tabs.Tab>
                <Tabs.Tab value="windows" size="xs">Windows</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="unix">
                <Box pos="relative">
                  <Code block style={{ fontSize: "var(--mantine-font-size-xs)" }}>
                    {npxCommand}
                  </Code>
                  <CopyButton value={npxCommand}>
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
              </Tabs.Panel>

              <Tabs.Panel value="windows">
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    First install globally from the release tarball, then run:
                  </Text>
                  <Box pos="relative">
                    <Code block style={{ fontSize: "var(--mantine-font-size-xs)" }}>
                      {windowsCommand}
                    </Code>
                    <CopyButton value={windowsCommand}>
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
                  <Alert color="yellow" variant="light">
                    <Text size="xs">
                      Windows requires a global install first:{" "}
                      <Code>npm install -g https://github.com/arjendev/launchpad-hq/releases/download/v0.1.0/launchpad-hq-0.1.0.tgz</Code>
                    </Text>
                  </Alert>
                </Stack>
              </Tabs.Panel>
            </Tabs>
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
    </Stack>
  );
}
