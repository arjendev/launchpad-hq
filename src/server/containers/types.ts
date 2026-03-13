/** Status of a discovered devcontainer. */
export type ContainerStatus = "running" | "stopped";

/** A discovered devcontainer and its metadata. */
export interface DevContainer {
  /** Docker container ID (short). */
  containerId: string;
  /** Docker container name. */
  name: string;
  /** Current status. */
  status: ContainerStatus;
  /** Workspace folder mounted inside the container. */
  workspaceFolder: string;
  /** Repository path or remote URL mapped from workspace folder (if determinable). */
  repository?: string;
  /** Exposed host ports (host:container format). */
  ports: string[];
  /** Docker image used. */
  image: string;
  /** When the container was created (ISO 8601). */
  createdAt: string;
}

/** Result of a discovery scan. */
export interface DiscoveryResult {
  /** Discovered devcontainers. */
  containers: DevContainer[];
  /** When this scan was performed (ISO 8601). */
  scannedAt: string;
  /** Whether Docker is available on this machine. */
  dockerAvailable: boolean;
  /** Human-readable error if discovery failed. */
  error?: string;
}

/** WebSocket payload pushed on the "devcontainer" channel. */
export interface ContainerStatusUpdate {
  type: "container_status_update";
  containers: DevContainer[];
  /** Containers whose status changed since the last scan. */
  changes: ContainerChange[];
  scannedAt: string;
}

/** A single container status change. */
export interface ContainerChange {
  containerId: string;
  name: string;
  previousStatus: ContainerStatus | "absent";
  currentStatus: ContainerStatus | "absent";
}

/** Configuration for the container monitor. */
export interface ContainerMonitorConfig {
  /** Polling interval in milliseconds. Default 10_000 (10s). */
  pollIntervalMs: number;
  /** Whether monitoring is enabled. */
  enabled: boolean;
}

export const DEFAULT_MONITOR_CONFIG: ContainerMonitorConfig = {
  pollIntervalMs: 10_000,
  enabled: true,
};
