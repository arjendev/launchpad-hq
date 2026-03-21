/**
 * Daemon entry point — started by `launchpad --daemon`.
 *
 * Reads config, connects to HQ via WebSocket, handles the auth
 * handshake, registers, then enters the heartbeat + message loop.
 */

import type { DaemonInfo } from '../shared/protocol.js';
import { CoordinatorSessionManager } from './copilot/coordinator.js';
import { IssueDispatcher } from './copilot/dispatch.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { loadDaemonConfig, type DaemonConfig } from './config.js';
import { DaemonWebSocketClient } from './client.js';
import { DaemonState } from './state.js';
import { setupDaemonTerminal, DaemonTerminalManager } from './terminal/index.js';
import { CopilotManager, discoverCopilotAgents } from './copilot/index.js';
import { CliSessionManager } from './copilot-cli/index.js';
import { logOutgoing } from './logger.js';
import { PreviewManager } from './preview-manager.js';
import { MessageRouter } from './message-router.js';

export interface DaemonProcess {
  client: DaemonWebSocketClient;
  state: DaemonState;
  terminalManager: DaemonTerminalManager;
  copilot: CopilotManager;
  cliSessions: CliSessionManager;
  previewHandler: PreviewManager;
  shutdown: () => void;
}

/**
 * Start the daemon process. Exported for testability; the CLI calls this.
 */
export function startDaemon(configOverrides?: Partial<DaemonConfig>): DaemonProcess {
  const config = loadDaemonConfig(configOverrides);
  const discoveredAgents = discoverCopilotAgents(process.cwd());

  const client = new DaemonWebSocketClient({
    hqUrl: config.hqUrl,
    token: config.token,
    projectId: config.projectId,
  });

  const state = new DaemonState({ daemonOnline: false });

  const daemonInfo: DaemonInfo = {
    projectId: config.projectId,
    projectName: config.projectName,
    runtimeTarget: detectRuntime(),
    capabilities: [],
    version: '0.1.0',
    protocolVersion: PROTOCOL_VERSION,
    agentCatalog: discoveredAgents.catalog,
  };

  // --- Terminal handler ---

  const { manager: terminalManager, cleanup: terminalCleanup } = setupDaemonTerminal({
    client,
    projectId: config.projectId,
  });

  // Attempt to load pty module (non-blocking — terminals won't work if unavailable)
  terminalManager.init().then((available) => {
    if (available) {
      addCapability(daemonInfo, 'terminal');
    }
  });

  // --- Copilot SDK integration ---

  const copilot = new CopilotManager({
    sendToHq: (msg) => client.send(msg),
    projectId: config.projectId,
    projectName: config.projectName,
    agentCatalog: discoveredAgents.catalog,
    customAgents: discoveredAgents.customAgents,
  });

  const cliSessions = new CliSessionManager({
    sendToHq: (msg) => client.send(msg),
    projectId: config.projectId,
    cwd: process.cwd(),
  });

  // --- Coordinator (autonomous issue worker) ---

  const coordinator = new CoordinatorSessionManager({
    sendToHq: (msg) => client.send(msg),
    copilotManager: copilot,
    projectId: config.projectId,
    projectName: config.projectName,
  });

  // --- IssueDispatcher (long-lived singleton) ---

  const issueDispatcher = new IssueDispatcher({
    sendToHq: (m) => client.send(m),
    copilotManager: copilot,
    coordinator,
    projectId: config.projectId,
  });

  addCapability(daemonInfo, 'copilot-sdk');
  addCapability(daemonInfo, 'copilot-cli');
  if (discoveredAgents.customAgents.length > 0) {
    addCapability(daemonInfo, 'copilot-custom-agents');
  }

  // --- Preview manager ---

  const previewManager = new PreviewManager({
    client,
    projectId: config.projectId,
    projectPath: config.projectPath,
    previewPort: config.previewPort,
    daemonInfo,
  });

  // --- Message router (single entry point for all HQ messages) ---

  const router = new MessageRouter({
    client,
    state,
    copilot,
    cliSessions,
    coordinator,
    issueDispatcher,
    previewManager,
  });

  // --- Connection lifecycle ---

  client.on('connected', () => {
    console.log(`🔌 Connected to HQ at ${config.hqUrl}`);
  });

  client.on('authenticated', () => {
    console.log('✅ Authenticated with HQ');
    logOutgoing('register', daemonInfo);
    client.sendRegistration(daemonInfo);
    if (daemonInfo.agentCatalog?.length) {
      logOutgoing('copilot-agent-catalog', {
        projectId: config.projectId,
        agents: daemonInfo.agentCatalog,
      });
      client.send({
        type: 'copilot-agent-catalog',
        timestamp: Date.now(),
        payload: {
          projectId: config.projectId,
          agents: daemonInfo.agentCatalog,
        },
      });
    }
    state.update({ daemonOnline: true, initialized: true });

    void copilot.start().catch((err) => {
      console.error(`⚠ Copilot SDK start failed: ${err}`);
    });

    previewManager.start();
  });

  client.on('auth-rejected', (reason) => {
    console.error(`❌ Auth rejected: ${reason}`);
  });

  client.on('disconnected', (_code, reason) => {
    console.log(`🔌 Disconnected from HQ: ${reason || 'unknown'}`);
    state.setOnline(false);
  });

  client.on('error', (err) => {
    console.error(`⚠ WebSocket error: ${err.message}`);
  });

  // --- Single message handler ---

  client.on('message', (msg) => {
    void router.handleMessage(msg);
  });

  state.onChange((newState) => {
    if (client.isAuthenticated) {
      client.sendStatusUpdate(newState);
    }
  });

  // --- Start connection ---

  console.log(`🚀 Daemon starting (project=${config.projectId}, hq=${config.hqUrl})`);
  client.connect();

  // --- Shutdown ---

  function shutdown(): void {
    console.log('\n⏏ Daemon shutting down…');
    previewManager.stop();
    void copilot.stop().catch(() => {});
    void coordinator.stop().catch(() => {});
    void cliSessions.stop().catch(() => {});
    terminalCleanup();
    state.setOnline(false);
    client.disconnect();
    console.log('👋 Daemon stopped.');
  }

  return { client, state, terminalManager, copilot, cliSessions, previewHandler: previewManager, shutdown };
}

function addCapability(daemonInfo: DaemonInfo, capability: string): void {
  if (!daemonInfo.capabilities.includes(capability)) {
    daemonInfo.capabilities.push(capability);
  }
}

/** Detect the runtime environment */
function detectRuntime(): DaemonInfo['runtimeTarget'] {
  if (process.env.REMOTE_CONTAINERS === 'true' || process.env.CODESPACES === 'true') {
    return 'wsl-devcontainer';
  }
  if (process.env.WSL_DISTRO_NAME) {
    return 'wsl';
  }
  return 'local';
}

// --- Direct execution (CLI) ---

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isDirectRun) {
  const daemon = startDaemon();

  process.on('SIGINT', () => {
    daemon.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    daemon.shutdown();
    process.exit(0);
  });
}
