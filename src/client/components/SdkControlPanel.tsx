import { useState } from "react";
import {
  Button,
  Collapse,
  Group,
  Paper,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import {
  useAggregatedSession,
  useListModels,
  useGetPlan,
  useSetModel,
  useSetMode,
  useDeletePlan,
} from "../services/hooks.js";
import type { CopilotSessionMode } from "../services/types.js";

const MODE_OPTIONS: Array<{ value: CopilotSessionMode; label: string }> = [
  { value: "interactive", label: "Interactive" },
  { value: "plan", label: "Plan" },
  { value: "autopilot", label: "Autopilot" },
];

export function SdkControlPanel({ sessionId }: { sessionId: string }) {
  const { data: session } = useAggregatedSession(sessionId);
  const { data: modelsData } = useListModels();
  const { data: planData } = useGetPlan(sessionId);
  const setModel = useSetModel();
  const setMode = useSetMode();
  const deletePlan = useDeletePlan();

  const [planExpanded, setPlanExpanded] = useState(false);

  const modelOptions = (modelsData?.models ?? []).map((m) => ({
    value: m.id,
    label: m.name,
  }));

  return (
    <Stack gap="xs" p="xs">
      {/* Model selector */}
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <Select
          label="Model"
          size="xs"
          data={modelOptions}
          value={session?.model ?? null}
          onChange={(val) => {
            if (val) setModel.mutate({ sessionId, model: val });
          }}
          placeholder="Select model"
          style={{ flex: 1 }}
          disabled={setModel.isPending}
          allowDeselect={false}
        />
      </Group>

      {/* Mode control */}
      <Stack gap={4}>
        <Text size="xs" fw={500}>
          Mode
        </Text>
        <Group gap={4}>
          {MODE_OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              size="compact-xs"
              variant={session?.mode === value ? "filled" : "light"}
              onClick={() => setMode.mutate({ sessionId, mode: value })}
              disabled={setMode.isPending}
            >
              {label}
            </Button>
          ))}
        </Group>
      </Stack>

      {/* Plan viewer */}
      <Stack gap={4}>
        <Group gap="xs" justify="space-between">
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => setPlanExpanded((p) => !p)}
          >
            📋 Plan {planExpanded ? "▾" : "▸"}
          </Button>
          {planData?.content && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              onClick={() => deletePlan.mutate(sessionId)}
              loading={deletePlan.isPending}
            >
              Delete Plan
            </Button>
          )}
        </Group>
        <Collapse in={planExpanded}>
          <Paper withBorder p="xs" radius="sm">
            <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
              {planData?.content || "No plan set"}
            </Text>
          </Paper>
        </Collapse>
      </Stack>

    </Stack>
  );
}
