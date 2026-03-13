import { Stack, Text, Title } from "@mantine/core";

const placeholderSessions = [
  "▶ devcontainer",
  "▶ copilot chat",
  "▶ terminal /bin",
];

export function SessionsPanel() {
  return (
    <Stack gap="xs" p="md">
      <Title order={4}>Sessions</Title>
      {placeholderSessions.map((session) => (
        <Text key={session} size="sm">
          {session}
        </Text>
      ))}
    </Stack>
  );
}
