import { Card, Flex, Stack, Text, Title } from "@mantine/core";

const columns = [
  { title: "Todo", color: "blue", items: ["#12", "#15"] },
  { title: "In Progress", color: "yellow", items: ["#8", "#14"] },
  { title: "Done", color: "green", items: ["#3", "#7"] },
];

export function KanbanBoard() {
  return (
    <Stack gap="md" p="md" style={{ flex: 1, minWidth: 0 }}>
      <Title order={4}>Board</Title>
      <Flex gap="md" wrap="wrap" style={{ flex: 1 }}>
        {columns.map((col) => (
          <Stack
            key={col.title}
            gap="xs"
            style={{ flex: 1, minWidth: 180 }}
          >
            <Text fw={600} size="sm" c={col.color}>
              {col.title}
            </Text>
            {col.items.map((item) => (
              <Card key={item} withBorder padding="sm" radius="sm">
                <Text size="sm">{item}</Text>
              </Card>
            ))}
          </Stack>
        ))}
      </Flex>
    </Stack>
  );
}
