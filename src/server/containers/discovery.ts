import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DevContainer, DiscoveryResult, ContainerStatus } from "./types.js";

const execFileAsync = promisify(execFile);

/** Label used by Dev Container CLI to tag devcontainers. */
const DEVCONTAINER_LABEL = "devcontainer.local_folder";

/**
 * Docker inspect JSON shape (subset of fields we use).
 * `docker inspect` returns an array of these.
 */
interface DockerInspectResult {
  Id: string;
  Name: string;
  State: { Status: string; StartedAt?: string };
  Config: {
    Image: string;
    Labels: Record<string, string>;
  };
  Created: string;
  HostConfig?: {
    PortBindings?: Record<string, Array<{ HostPort: string }> | null>;
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostPort: string }> | null>;
  };
}

// Exported for testing
export interface DockerExecutor {
  exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

const defaultExecutor: DockerExecutor = {
  async exec(command: string, args: string[]) {
    return execFileAsync(command, args, { timeout: 10_000 });
  },
};

/** Check whether the Docker CLI is available and the daemon is responsive. */
export async function isDockerAvailable(executor: DockerExecutor = defaultExecutor): Promise<boolean> {
  try {
    await executor.exec("docker", ["info", "--format", "{{.ID}}"]);
    return true;
  } catch {
    return false;
  }
}

/** Parse container ports from Docker inspect NetworkSettings. */
function parsePorts(inspect: DockerInspectResult): string[] {
  const ports: string[] = [];
  const portMap = inspect.NetworkSettings?.Ports ?? {};

  for (const [containerPort, bindings] of Object.entries(portMap)) {
    if (bindings && bindings.length > 0) {
      for (const binding of bindings) {
        if (binding.HostPort) {
          ports.push(`${binding.HostPort}:${containerPort}`);
        }
      }
    }
  }
  return ports;
}

/** Map Docker status string to our ContainerStatus. */
function mapStatus(dockerStatus: string): ContainerStatus {
  return dockerStatus === "running" ? "running" : "stopped";
}

/** Discover devcontainers using Docker CLI. */
export async function discoverContainers(
  executor: DockerExecutor = defaultExecutor,
): Promise<DiscoveryResult> {
  const scannedAt = new Date().toISOString();

  // Check Docker availability first
  const dockerAvailable = await isDockerAvailable(executor);
  if (!dockerAvailable) {
    return {
      containers: [],
      scannedAt,
      dockerAvailable: false,
      error: "Docker is not available. Ensure Docker is installed and the daemon is running.",
    };
  }

  try {
    // Find containers with the devcontainer label
    const { stdout: containerIds } = await executor.exec("docker", [
      "ps",
      "-a",
      "--filter", `label=${DEVCONTAINER_LABEL}`,
      "--format", "{{.ID}}",
    ]);

    const ids = containerIds.trim().split("\n").filter(Boolean);

    if (ids.length === 0) {
      return { containers: [], scannedAt, dockerAvailable: true };
    }

    // Inspect all devcontainers in one call
    const { stdout: inspectJson } = await executor.exec("docker", [
      "inspect", ...ids,
    ]);

    const inspected: DockerInspectResult[] = JSON.parse(inspectJson);

    const containers: DevContainer[] = inspected.map((c) => ({
      containerId: c.Id.substring(0, 12),
      name: c.Name.replace(/^\//, ""),
      status: mapStatus(c.State.Status),
      workspaceFolder: c.Config.Labels[DEVCONTAINER_LABEL] ?? "",
      repository: extractRepoFromLabels(c.Config.Labels),
      ports: parsePorts(c),
      image: c.Config.Image,
      createdAt: c.Created,
    }));

    return { containers, scannedAt, dockerAvailable: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      containers: [],
      scannedAt,
      dockerAvailable: true,
      error: `Container discovery failed: ${message}`,
    };
  }
}

/** Try to derive a repository identifier from devcontainer labels. */
function extractRepoFromLabels(labels: Record<string, string>): string | undefined {
  // vscode-remote sets the local folder as a label
  const localFolder = labels[DEVCONTAINER_LABEL];
  if (localFolder) {
    // Extract the last path segment(s) that look like owner/repo
    const parts = localFolder.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
    if (parts.length === 1) {
      return parts[0];
    }
  }
  return undefined;
}
