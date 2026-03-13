import type {
  ContainerMonitorConfig,
  ContainerStatusUpdate,
  ContainerChange,
  DevContainer,
  ContainerStatus,
  DiscoveryResult,
} from "./types.js";
import { DEFAULT_MONITOR_CONFIG } from "./types.js";
import { discoverContainers, type DockerExecutor } from "./discovery.js";

export type BroadcastFn = (channel: "devcontainer", payload: ContainerStatusUpdate) => void;

interface Logger {
  info(msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Monitors devcontainer state and broadcasts changes via WebSocket.
 *
 * Polling-based: runs `discoverContainers()` on an interval, diffs against
 * the previous snapshot, and pushes changes to the "devcontainer" channel.
 */
export class ContainerMonitor {
  private config: ContainerMonitorConfig;
  private broadcast: BroadcastFn;
  private executor: DockerExecutor | undefined;
  private log: Logger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private previousContainers: Map<string, DevContainer> = new Map();
  private _lastResult: DiscoveryResult | null = null;

  constructor(opts: {
    broadcast: BroadcastFn;
    log: Logger;
    config?: Partial<ContainerMonitorConfig>;
    executor?: DockerExecutor;
  }) {
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...opts.config };
    this.broadcast = opts.broadcast;
    this.log = opts.log;
    this.executor = opts.executor;
  }

  /** Start the polling loop. */
  start(): void {
    if (this.timer) return; // already running
    if (!this.config.enabled) {
      this.log.info("Container monitoring is disabled");
      return;
    }

    this.log.info(`Container monitor started (interval: ${this.config.pollIntervalMs}ms)`);

    // Run initial scan immediately
    void this.poll();

    this.timer = setInterval(() => {
      void this.poll();
    }, this.config.pollIntervalMs);
  }

  /** Stop the polling loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.info("Container monitor stopped");
    }
  }

  /** Get the last discovery result (for the REST endpoint). */
  get lastResult(): DiscoveryResult | null {
    return this._lastResult;
  }

  /** Run a single poll cycle. Exported for testing. */
  async poll(): Promise<void> {
    try {
      const result = await discoverContainers(this.executor);
      this._lastResult = result;

      if (!result.dockerAvailable) {
        // Don't spam on every poll — only log once when Docker disappears
        if (this.previousContainers.size > 0) {
          this.log.warn("Docker became unavailable — clearing container state");
          this.previousContainers.clear();
        }
        return;
      }

      const changes = this.diffContainers(result.containers);

      // Always broadcast current state + changes to subscribers
      if (changes.length > 0) {
        this.log.info({ changeCount: changes.length }, "Container state changes detected");

        const update: ContainerStatusUpdate = {
          type: "container_status_update",
          containers: result.containers,
          changes,
          scannedAt: result.scannedAt,
        };

        this.broadcast("devcontainer", update);
      }

      // Update snapshot
      this.previousContainers = new Map(
        result.containers.map((c) => [c.containerId, c]),
      );
    } catch (err) {
      this.log.error({ err } as Record<string, unknown>, "Container poll failed");
    }
  }

  /** Diff current containers against the previous snapshot. */
  private diffContainers(current: DevContainer[]): ContainerChange[] {
    const changes: ContainerChange[] = [];
    const currentMap = new Map(current.map((c) => [c.containerId, c]));

    // Check for new or changed containers
    for (const container of current) {
      const prev = this.previousContainers.get(container.containerId);
      if (!prev) {
        // New container
        changes.push({
          containerId: container.containerId,
          name: container.name,
          previousStatus: "absent",
          currentStatus: container.status,
        });
      } else if (prev.status !== container.status) {
        // Status changed
        changes.push({
          containerId: container.containerId,
          name: container.name,
          previousStatus: prev.status as ContainerStatus,
          currentStatus: container.status,
        });
      }
    }

    // Check for removed containers
    for (const [id, prev] of this.previousContainers) {
      if (!currentMap.has(id)) {
        changes.push({
          containerId: id,
          name: prev.name,
          previousStatus: prev.status,
          currentStatus: "absent",
        });
      }
    }

    return changes;
  }
}
