/**
 * Daemon terminal command handler.
 *
 * Bridges incoming HQ messages (terminal-spawn, terminal-input,
 * terminal-resize, terminal-kill) to the local DaemonTerminalManager,
 * and routes PTY output / exit events back to HQ.
 */

import type { DaemonWebSocketClient } from '../client.js';
import type { HqToDaemonMessage } from '../../shared/protocol.js';
import { DaemonTerminalManager } from './manager.js';

export { DaemonTerminalManager } from './manager.js';

export interface DaemonTerminalHandlerOptions {
  client: DaemonWebSocketClient;
  projectId: string;
  manager?: DaemonTerminalManager;
}

/**
 * Create and wire a terminal handler for the daemon.
 * Returns the manager instance and a cleanup function.
 */
export function setupDaemonTerminal(options: DaemonTerminalHandlerOptions) {
  const { client, projectId } = options;
  const manager = options.manager ?? new DaemonTerminalManager();

  function handleMessage(msg: HqToDaemonMessage): void {
    switch (msg.type) {
      case 'terminal-spawn': {
        const { terminalId, cols, rows } = msg.payload;
        try {
          manager.spawn(terminalId, { cols, rows });

          // Wire PTY output → HQ
          manager.onData(terminalId, (data) => {
            client.send({
              type: 'terminal-data',
              timestamp: Date.now(),
              payload: { projectId, sessionId: terminalId, data },
            });
          });

          // Wire PTY exit → HQ
          manager.onExit(terminalId, (exitCode) => {
            client.send({
              type: 'terminal-exit',
              timestamp: Date.now(),
              payload: { projectId, terminalId, exitCode },
            });
          });
        } catch (err) {
          console.error(`Failed to spawn terminal '${terminalId}':`, err);
        }
        break;
      }

      case 'terminal-input': {
        const { sessionId, data } = msg.payload;
        try {
          manager.write(sessionId, data);
        } catch {
          // Session may have already exited
        }
        break;
      }

      case 'terminal-resize': {
        const { terminalId, cols, rows } = msg.payload;
        try {
          manager.resize(terminalId, cols, rows);
        } catch {
          // Session may have already exited
        }
        break;
      }

      case 'terminal-kill': {
        const { terminalId } = msg.payload;
        manager.kill(terminalId);
        break;
      }

      default:
        // Not a terminal message — ignore
        break;
    }
  }

  // Listen for all HQ messages and route terminal ones
  client.on('message', handleMessage);

  function cleanup(): void {
    client.removeListener('message', handleMessage);
    manager.killAll();
  }

  return { manager, cleanup };
}
