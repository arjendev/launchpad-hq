import { ActionIcon, Tooltip } from "@mantine/core";
import { IconWorldShare } from "@tabler/icons-react";
import { useState } from "react";
import { useTunnelStatus } from "../services/hooks.js";
import { TunnelModal } from "./TunnelModal.js";

const statusStyles = {
  stopped: { color: "gray", tooltip: "Dev Tunnel" },
  starting: { color: "blue", tooltip: "Tunnel starting…" },
  running: { color: "green", tooltip: "Tunnel Active — click to share" },
  stopping: { color: "blue", tooltip: "Tunnel stopping…" },
  error: { color: "red", tooltip: "Tunnel Error — click for details" },
} as const;

export function TunnelButton() {
  const [opened, setOpened] = useState(false);
  const { data: tunnel } = useTunnelStatus();

  const status = tunnel?.status ?? "stopped";
  const { color, tooltip } = statusStyles[status];

  return (
    <>
      <Tooltip label={tooltip} position="bottom" withArrow>
        <ActionIcon
          variant="subtle"
          size="md"
          color={color}
          onClick={() => setOpened(true)}
          aria-label="Dev Tunnel"
          style={
            status === "running"
              ? { animation: "tunnel-pulse 2s ease-in-out infinite" }
              : undefined
          }
        >
          <IconWorldShare size={18} />
        </ActionIcon>
      </Tooltip>

      <TunnelModal opened={opened} onClose={() => setOpened(false)} />
    </>
  );
}
