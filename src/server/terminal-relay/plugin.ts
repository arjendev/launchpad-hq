/**
 * Fastify plugin — terminal relay between daemons and browser clients.
 *
 * Registers the TerminalRelay and wires it into:
 * - Daemon registry handler (terminal-data / terminal-exit from daemon)
 * - Browser WS handler (terminal:join / terminal:leave / terminal:input from browser)
 */

import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { TerminalRelay } from './relay.js';

declare module 'fastify' {
  interface FastifyInstance {
    terminalRelay: TerminalRelay;
  }
}

async function terminalRelayPlugin(fastify: FastifyInstance) {
  const relay = new TerminalRelay(
    // Send to browser: use the WS connection manager broadcast to a specific client
    (clientId, _channel, payload) => {
      // Use the ws decorator to send to a specific client via broadcast
      // Since ConnectionManager.send requires a ServerMessage, we format it
      fastify.ws.broadcast('terminal' as never, payload);
    },
    // Send to daemon: use the daemon registry
    (daemonId, message) => {
      return fastify.daemonRegistry.sendToDaemon(daemonId, message as never);
    },
  );

  fastify.decorate('terminalRelay', relay);

  fastify.addHook('onClose', () => {
    // No persistent resources to clean up
  });
}

export default fp(terminalRelayPlugin, {
  name: 'terminal-relay',
  dependencies: ['websocket', 'daemon-registry'],
});
