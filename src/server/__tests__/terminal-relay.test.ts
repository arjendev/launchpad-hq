import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalRelay } from '../terminal-relay/relay.js';

describe('TerminalRelay', () => {
  let sendToBrowser: ReturnType<typeof vi.fn>;
  let sendToDaemon: ReturnType<typeof vi.fn>;
  let relay: TerminalRelay;

  beforeEach(() => {
    sendToBrowser = vi.fn();
    sendToDaemon = vi.fn(() => true);
    relay = new TerminalRelay(sendToBrowser, sendToDaemon);
  });

  describe('join / leave', () => {
    it('join adds browser client to terminal binding', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');
      expect(relay.getClients('daemon-1', 'term-1')).toEqual(['browser-1']);
    });

    it('multiple browsers can join the same terminal', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');
      relay.join('browser-2', 'daemon-1', 'term-1');
      expect(relay.getClients('daemon-1', 'term-1').sort()).toEqual(['browser-1', 'browser-2']);
    });

    it('same browser can join multiple terminals', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');
      relay.join('browser-1', 'daemon-1', 'term-2');
      expect(relay.getClients('daemon-1', 'term-1')).toEqual(['browser-1']);
      expect(relay.getClients('daemon-1', 'term-2')).toEqual(['browser-1']);
    });

    it('leave removes browser from terminal binding', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');
      relay.leave('browser-1', 'daemon-1', 'term-1');
      expect(relay.getClients('daemon-1', 'term-1')).toEqual([]);
    });

    it('leave is a no-op for non-joined client', () => {
      relay.leave('ghost', 'daemon-1', 'term-1');
      expect(relay.getClients('daemon-1', 'term-1')).toEqual([]);
    });

    it('duplicate join is idempotent', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');
      relay.join('browser-1', 'daemon-1', 'term-1');
      expect(relay.getClients('daemon-1', 'term-1')).toEqual(['browser-1']);
    });
  });

  describe('removeClient', () => {
    it('removes browser from all terminals', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');
      relay.join('browser-1', 'daemon-1', 'term-2');
      relay.join('browser-1', 'daemon-2', 'term-3');

      relay.removeClient('browser-1');

      expect(relay.getClients('daemon-1', 'term-1')).toEqual([]);
      expect(relay.getClients('daemon-1', 'term-2')).toEqual([]);
      expect(relay.getClients('daemon-2', 'term-3')).toEqual([]);
    });

    it('does not affect other clients', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');
      relay.join('browser-2', 'daemon-1', 'term-1');

      relay.removeClient('browser-1');
      expect(relay.getClients('daemon-1', 'term-1')).toEqual(['browser-2']);
    });

    it('is a no-op for unknown client', () => {
      relay.removeClient('ghost');
      // Should not throw
    });
  });

  describe('forwardFromDaemon', () => {
    it('sends data to all joined browser clients', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');
      relay.join('browser-2', 'daemon-1', 'term-1');

      relay.forwardFromDaemon('daemon-1', 'term-1', 'hello');

      expect(sendToBrowser).toHaveBeenCalledTimes(2);
      expect(sendToBrowser).toHaveBeenCalledWith('browser-1', 'terminal', {
        type: 'terminal:data',
        daemonId: 'daemon-1',
        terminalId: 'term-1',
        data: 'hello',
      });
      expect(sendToBrowser).toHaveBeenCalledWith('browser-2', 'terminal', {
        type: 'terminal:data',
        daemonId: 'daemon-1',
        terminalId: 'term-1',
        data: 'hello',
      });
    });

    it('does nothing if no clients joined', () => {
      relay.forwardFromDaemon('daemon-1', 'term-1', 'hello');
      expect(sendToBrowser).not.toHaveBeenCalled();
    });

    it('only sends to clients of the specific terminal', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');
      relay.join('browser-2', 'daemon-1', 'term-2');

      relay.forwardFromDaemon('daemon-1', 'term-1', 'hello');

      expect(sendToBrowser).toHaveBeenCalledTimes(1);
      expect(sendToBrowser).toHaveBeenCalledWith('browser-1', 'terminal', expect.anything());
    });
  });

  describe('forwardExitFromDaemon', () => {
    it('sends exit event to all joined browsers', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');

      relay.forwardExitFromDaemon('daemon-1', 'term-1', 0);

      expect(sendToBrowser).toHaveBeenCalledWith('browser-1', 'terminal', {
        type: 'terminal:exit',
        daemonId: 'daemon-1',
        terminalId: 'term-1',
        exitCode: 0,
      });
    });

    it('cleans up bindings after exit', () => {
      relay.join('browser-1', 'daemon-1', 'term-1');

      relay.forwardExitFromDaemon('daemon-1', 'term-1', 1);

      expect(relay.getClients('daemon-1', 'term-1')).toEqual([]);
    });
  });

  describe('forwardToDaemon', () => {
    it('sends terminal-input to the daemon', () => {
      relay.forwardToDaemon('daemon-1', 'term-1', 'ls\n');

      expect(sendToDaemon).toHaveBeenCalledTimes(1);
      const call = sendToDaemon.mock.calls[0];
      expect(call[0]).toBe('daemon-1');
      const msg = call[1] as { type: string; payload: { projectId: string; sessionId: string; data: string } };
      expect(msg.type).toBe('terminal-input');
      expect(msg.payload.sessionId).toBe('term-1');
      expect(msg.payload.data).toBe('ls\n');
    });
  });

  describe('getClients', () => {
    it('returns empty array for unknown terminal', () => {
      expect(relay.getClients('x', 'y')).toEqual([]);
    });
  });
});
