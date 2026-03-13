export { default as containersPlugin } from "./plugin.js";
export { ContainerMonitor } from "./monitor.js";
export { discoverContainers, isDockerAvailable } from "./discovery.js";
export type {
  DevContainer,
  ContainerStatus,
  DiscoveryResult,
  ContainerStatusUpdate,
  ContainerChange,
  ContainerMonitorConfig,
} from "./types.js";
export { DEFAULT_MONITOR_CONFIG } from "./types.js";
