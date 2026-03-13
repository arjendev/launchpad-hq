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

export interface DaemonProcess {
  client: DaemonWebSocketClient;
  state: DaemonState;
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
      client.sendStatusUpdate(state.current);
    }
  });

  state.onChange((newState) => {
    if (client.isAuthenticated) {
      client.sendStatusUpdate(newState);
    }
  });

  // --- Start connection ---

  client.connect();

  // --- Shutdown ---

  function shutdown(): void {
    console.log('\n⏏ Daemon shutting down…');
    state.setOnline(false);
    client.disconnect();
    console.log('👋 Daemon stopped.');
  }

  return { client, state, shutdown };
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
