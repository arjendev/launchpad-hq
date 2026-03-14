/**
 * Daemon entry point — started by `launchpad --daemon`.
 *
 * Reads config, connects to HQ via WebSocket, handles the auth
 * handshake, registers, then enters the heartbeat + message loop.
 */

import type { DaemonInfo } from '../shared/protocol.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { loadDaemonConfig, type DaemonConfig } from './config.js';
import { DaemonWebSocketClient } from './client.js';
import { DaemonState } from './state.js';
import { setupDaemonTerminal, DaemonTerminalManager } from './terminal/index.js';
import { CopilotManager } from './copilot/index.js';
import { CliSessionManager } from './copilot-cli/index.js';
import { SquadSessionManager } from './squad/index.js';
import { logIncoming, logOutgoing } from './logger.js';

export interface DaemonProcess {
  client: DaemonWebSocketClient;
  state: DaemonState;
  terminalManager: DaemonTerminalManager;
  copilot: CopilotManager;
  cliSessions: CliSessionManager;
  squadSessions: SquadSessionManager;
  shutdown: () => void;
}

/**
 * Start the daemon process. Exported for testability; the CLI calls this.
 */
export function startDaemon(configOverrides?: Partial<DaemonConfig>): DaemonProcess {
  const config = loadDaemonConfig(configOverrides);

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
  };

  // --- Connection lifecycle ---

  client.on('connected', () => {
    console.log(`🔌 Connected to HQ at ${config.hqUrl}`);
  });

  client.on('authenticated', () => {
    console.log('✅ Authenticated with HQ');
    logOutgoing('register', daemonInfo);
    client.sendRegistration(daemonInfo);
    state.update({ daemonOnline: true, initialized: true });
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

  // --- State change → HQ notification ---

  client.on('message', (msg) => {
    if (msg.type === 'request-status') {
      logIncoming(msg.type, msg.payload);
      client.sendStatusUpdate(state.current);
    }
  });

  state.onChange((newState) => {
    if (client.isAuthenticated) {
      client.sendStatusUpdate(newState);
    }
  });

  // --- Terminal handler ---

  const { manager: terminalManager, cleanup: terminalCleanup } = setupDaemonTerminal({
    client,
    projectId: config.projectId,
  });

  // Attempt to load node-pty (non-blocking — terminals won't work if unavailable)
  terminalManager.init().then((available) => {
    if (available) {
      daemonInfo.capabilities.push('terminal');
    }
  });

  // --- Copilot SDK integration ---

  const copilot = new CopilotManager({
    sendToHq: (msg) => client.send(msg),
    projectId: config.projectId,
  });

  const cliSessions = new CliSessionManager({
    sendToHq: (msg) => client.send(msg),
    projectId: config.projectId,
    cwd: process.cwd(),
  });

  const squadSessions = new SquadSessionManager({
    sendToHq: (msg) => client.send(msg),
    projectId: config.projectId,
  });

  client.on('message', async (msg) => {
    if (!msg.type.startsWith('copilot-') && !msg.type.startsWith('terminal-')) return;

    // Try CLI session manager first (handles its own sessions + copilot-cli type)
    const handledByCli = await cliSessions.handleMessage(msg);
    if (handledByCli) return;

    // Try Squad session manager (handles squad-sdk type)
    const handledBySquad = await squadSessions.handleMessage(msg);
    if (handledBySquad) return;

    // Fall through to default CopilotManager (copilot-sdk type)
    if (msg.type.startsWith('copilot-')) {
      void copilot.handleMessage(msg);
    }
  });

  client.on('authenticated', () => {
    void copilot.start().catch((err) => {
      console.error(`⚠ Copilot SDK start failed: ${err}`);
    });

    // Report capabilities
    daemonInfo.capabilities.push('copilot-sdk');
    daemonInfo.capabilities.push('copilot-cli');
    if (squadSessions.isAvailable()) {
      daemonInfo.capabilities.push('squad-sdk');
    }
  });

  // --- Start connection ---

  console.log(`🚀 Daemon starting (project=${config.projectId}, hq=${config.hqUrl})`);
  client.connect();

  // --- Shutdown ---

  function shutdown(): void {
    console.log('\n⏏ Daemon shutting down…');
    void copilot.stop().catch(() => {});
    void cliSessions.stop().catch(() => {});
    void squadSessions.stop().catch(() => {});
    terminalCleanup();
    state.setOnline(false);
    client.disconnect();
    console.log('👋 Daemon stopped.');
  }

  return { client, state, terminalManager, copilot, cliSessions, squadSessions, shutdown };
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
