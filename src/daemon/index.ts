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
import { CopilotManager, discoverCopilotAgents } from './copilot/index.js';
import { CliSessionManager } from './copilot-cli/index.js';
import { logIncoming, logOutgoing } from './logger.js';
import { PreviewProxyHandler } from './preview.js';
import { detectPreviewPort } from './preview-detect.js';

export interface DaemonProcess {
  client: DaemonWebSocketClient;
  state: DaemonState;
  terminalManager: DaemonTerminalManager;
  copilot: CopilotManager;
  cliSessions: CliSessionManager;
  previewHandler: PreviewProxyHandler | null;
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

  addCapability(daemonInfo, 'copilot-sdk');
  addCapability(daemonInfo, 'copilot-cli');
  if (discoveredAgents.customAgents.length > 0) {
    addCapability(daemonInfo, 'copilot-custom-agents');
  }

  client.on('message', async (msg) => {
    if (!msg.type.startsWith('copilot-') && !msg.type.startsWith('terminal-')) return;

    // Try CLI session manager first (handles its own sessions + copilot-cli type)
    const handledByCli = await cliSessions.handleMessage(msg);
    if (handledByCli) return;

    // Fall through to default CopilotManager (copilot-sdk type)
    if (msg.type.startsWith('copilot-')) {
      void copilot.handleMessage(msg);
    }
  });

  client.on('authenticated', () => {
    void copilot.start().catch((err) => {
      console.error(`⚠ Copilot SDK start failed: ${err}`);
    });
  });

  // --- Preview proxy handler ---

  let previewHandler: PreviewProxyHandler | null = null;
  let previewDetectTimer: ReturnType<typeof setInterval> | null = null;

  function startPreview(port: number, autoDetected: boolean, detectedFrom?: 'config' | 'devcontainer' | 'port-scan' | 'package-json'): void {
    if (previewHandler) return; // Already running
    previewHandler = new PreviewProxyHandler({
      client,
      projectId: config.projectId,
      previewPort: port,
      autoDetected,
      detectedFrom,
    });
    addCapability(daemonInfo, 'preview');
    console.log(`🖼 Preview proxy enabled on port ${port} (${detectedFrom ?? 'config'})`);
  }

  // Preview message routing (must be registered before connection)
  client.on('message', (msg) => {
    if (!msg.type.startsWith('preview-')) return;
    if (previewHandler) {
      previewHandler.handleMessage(msg);
    }
  });

  // On authentication: send config if explicit port, or auto-detect
  client.on('authenticated', () => {
    if (config.previewPort) {
      console.log(`🔍 Preview detect: explicit previewPort=${config.previewPort} configured, skipping auto-detection`);
      startPreview(config.previewPort, false, 'config');
      previewHandler!.sendConfig();
    } else {
      console.log(`🔍 Preview detect: no explicit previewPort, attempting auto-detection for projectPath=${config.projectPath}`);
      // Auto-detect on first auth, then periodically (dev server may start later)
      void detectAndStartPreview();
      previewDetectTimer = setInterval(() => {
        if (!previewHandler) void detectAndStartPreview();
      }, 30_000);
    }
  });

  async function detectAndStartPreview(): Promise<void> {
    try {
      const detected = await detectPreviewPort(config.projectPath);
      console.log(`🔍 Preview detect: detection result = ${detected ? `port ${detected.port} from ${detected.source}` : 'null'}`);
      if (detected && !previewHandler) {
        startPreview(detected.port, true, detected.source);
        if (client.isAuthenticated) {
          previewHandler!.sendConfig();
        }
        // Stop polling once we found a port
        if (previewDetectTimer) {
          clearInterval(previewDetectTimer);
          previewDetectTimer = null;
        }
      }
    } catch {
      // Silent — detection is best-effort
    }
  }

  // --- Start connection ---

  console.log(`🚀 Daemon starting (project=${config.projectId}, hq=${config.hqUrl})`);
  client.connect();

  // --- Shutdown ---

  function shutdown(): void {
    console.log('\n⏏ Daemon shutting down…');
    if (previewDetectTimer) {
      clearInterval(previewDetectTimer);
      previewDetectTimer = null;
    }
    if (previewHandler) {
      previewHandler.cleanup();
    }
    void copilot.stop().catch(() => {});
    void cliSessions.stop().catch(() => {});
    terminalCleanup();
    state.setOnline(false);
    client.disconnect();
    console.log('👋 Daemon stopped.');
  }

  return { client, state, terminalManager, copilot, cliSessions, previewHandler, shutdown };
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
