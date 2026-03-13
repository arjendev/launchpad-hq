import { Stack, Text, Title, UnstyledButton } from "@mantine/core";

const placeholderProjects = ["repo-alpha", "repo-beta", "repo-gamma"];

export function ProjectList() {
  return (
    <Stack gap="xs" p="md">
      <Title order={4}>Projects</Title>
      {placeholderProjects.map((name) => (
        <UnstyledButton
          key={name}
          p="xs"
          style={{ borderRadius: "var(--mantine-radius-sm)" }}
        >
          <Text size="sm">● {name}</Text>
        </UnstyledButton>
      ))}
    </Stack>
  );
}
