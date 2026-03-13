/**
 * HQ-side terminal relay.
 *
 * Bridges terminal data between daemons and browser clients.
 * Browser clients "join" a terminal session (daemonId + terminalId),
 * and the relay forwards data in both directions.
 */

export interface BrowserTerminalBinding {
  clientId: string;
  daemonId: string;
  terminalId: string;
}

/** Callback to send a message to a specific browser client */
export type SendToBrowser = (clientId: string, channel: string, payload: unknown) => void;

/** Callback to send a message to a specific daemon */
export type SendToDaemon = (daemonId: string, message: unknown) => boolean;

export class TerminalRelay {
  // Map of `${daemonId}:${terminalId}` → Set of browser clientIds
  private bindings = new Map<string, Set<string>>();
  // Reverse map: clientId → Set of terminal keys
  private clientTerminals = new Map<string, Set<string>>();

  private sendToBrowser: SendToBrowser;
  private sendToDaemon: SendToDaemon;

  constructor(sendToBrowser: SendToBrowser, sendToDaemon: SendToDaemon) {
    this.sendToBrowser = sendToBrowser;
    this.sendToDaemon = sendToDaemon;
  }

  /** Browser client wants to receive output from a terminal session. */
  join(clientId: string, daemonId: string, terminalId: string): void {
    const key = this.key(daemonId, terminalId);

    let clients = this.bindings.get(key);
    if (!clients) {
      clients = new Set();
      this.bindings.set(key, clients);
    }
    clients.add(clientId);

    let terminals = this.clientTerminals.get(clientId);
    if (!terminals) {
      terminals = new Set();
      this.clientTerminals.set(clientId, terminals);
    }
    terminals.add(key);
  }

  /** Browser client stops receiving from a terminal session. */
  leave(clientId: string, daemonId: string, terminalId: string): void {
    const key = this.key(daemonId, terminalId);

    const clients = this.bindings.get(key);
    if (clients) {
      clients.delete(clientId);
      if (clients.size === 0) this.bindings.delete(key);
    }

    const terminals = this.clientTerminals.get(clientId);
    if (terminals) {
      terminals.delete(key);
      if (terminals.size === 0) this.clientTerminals.delete(clientId);
    }
  }

  /** Remove a browser client from all terminal sessions (e.g. disconnect). */
  removeClient(clientId: string): void {
    const terminals = this.clientTerminals.get(clientId);
    if (!terminals) return;

    for (const key of terminals) {
      const clients = this.bindings.get(key);
      if (clients) {
        clients.delete(clientId);
        if (clients.size === 0) this.bindings.delete(key);
      }
    }
    this.clientTerminals.delete(clientId);
  }

  /**
   * Forward PTY output from a daemon to all joined browser clients.
   * Called when the daemon sends terminal-data.
   */
  forwardFromDaemon(daemonId: string, terminalId: string, data: string): void {
    const key = this.key(daemonId, terminalId);
    const clients = this.bindings.get(key);
    if (!clients) return;

    for (const clientId of clients) {
      this.sendToBrowser(clientId, 'terminal', {
        type: 'terminal:data',
        daemonId,
        terminalId,
        data,
      });
    }
  }

  /**
   * Forward a terminal exit event from daemon to all joined browser clients.
   */
  forwardExitFromDaemon(daemonId: string, terminalId: string, exitCode: number): void {
    const key = this.key(daemonId, terminalId);
    const clients = this.bindings.get(key);
    if (!clients) return;

    for (const clientId of clients) {
      this.sendToBrowser(clientId, 'terminal', {
        type: 'terminal:exit',
        daemonId,
        terminalId,
        exitCode,
      });
    }

    // Clean up bindings for this terminal
    for (const clientId of clients) {
      const terminals = this.clientTerminals.get(clientId);
      if (terminals) {
        terminals.delete(key);
        if (terminals.size === 0) this.clientTerminals.delete(clientId);
      }
    }
    this.bindings.delete(key);
  }

  /**
   * Forward input from a browser client to the daemon.
   */
  forwardToDaemon(daemonId: string, terminalId: string, data: string): void {
    this.sendToDaemon(daemonId, {
      type: 'terminal-input',
      timestamp: Date.now(),
      payload: {
        projectId: daemonId,
        sessionId: terminalId,
        data,
      },
    });
  }

  /** Get browser client IDs joined to a terminal session. */
  getClients(daemonId: string, terminalId: string): string[] {
    const key = this.key(daemonId, terminalId);
    const clients = this.bindings.get(key);
    return clients ? [...clients] : [];
  }

  private key(daemonId: string, terminalId: string): string {
    return `${daemonId}:${terminalId}`;
  }
}
