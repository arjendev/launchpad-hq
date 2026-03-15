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
    </Stack>
  );
}
