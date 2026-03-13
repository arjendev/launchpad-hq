import { Badge, Tooltip } from "@mantine/core";
import { useWebSocket } from "../contexts/WebSocketContext.js";
import type { ConnectionStatus as Status } from "../services/ws-types.js";

const statusConfig: Record<Status, { color: string; label: string; tooltip: string }> = {
  connected: { color: "green", label: "Live", tooltip: "Connected to server" },
  connecting: { color: "yellow", label: "Connecting…", tooltip: "Establishing connection" },
  reconnecting: { color: "yellow", label: "Reconnecting…", tooltip: "Connection lost — retrying" },
  disconnected: { color: "red", label: "Offline", tooltip: "Not connected to server" },
};

export function ConnectionStatus() {
  const { status } = useWebSocket();
  const { color, label, tooltip } = statusConfig[status];

  return (
    <Tooltip label={tooltip} position="bottom" withArrow>
      <Badge
        color={color}
        variant="dot"
        size="sm"
        style={{ cursor: "default" }}
      >
        {label}
      </Badge>
    </Tooltip>
  );
}
