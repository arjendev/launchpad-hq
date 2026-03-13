import { describe, it, expect } from 'vitest';
import type {
  WsMessage,
  DaemonToHqMessage,
  HqToDaemonMessage,
  RegisterMessage,
  HeartbeatMessage,
  StatusUpdateMessage,
  TerminalDataMessage,
  CopilotSessionUpdateMessage,
  CopilotConversationMessage,
  AttentionItemMessage,
  AuthResponseMessage,
  AuthChallengeMessage,
  AuthAcceptMessage,
  AuthRejectMessage,
  CommandMessage,
  TerminalInputMessage,
  RequestStatusMessage,
  RuntimeTarget,
  WorkState,
  ProjectState,
  DaemonInfo,
  MessageType,
} from '../protocol.js';
import { PROTOCOL_VERSION } from '../constants.js';

// ---------------------------------------------------------------------------
// Helpers — build valid message literals and assert TypeScript accepts them
// ---------------------------------------------------------------------------

const now = Date.now();

describe('Protocol message types', () => {
  describe('Daemon → HQ messages', () => {
    it('register message has correct shape', () => {
      const msg: RegisterMessage = {
        type: 'register',
        timestamp: now,
        payload: {
          projectId: 'proj-1',
          projectName: 'my-project',
          runtimeTarget: 'wsl-devcontainer',
          capabilities: ['terminal', 'copilot'],
          version: '0.1.0',
          protocolVersion: PROTOCOL_VERSION,
        },
      };
      expect(msg.type).toBe('register');
      expect(msg.payload.projectId).toBe('proj-1');
      expect(msg.payload.capabilities).toContain('terminal');
    });

    it('heartbeat message has correct shape', () => {
      const msg: HeartbeatMessage = {
        type: 'heartbeat',
        timestamp: now,
        payload: { projectId: 'proj-1', uptimeMs: 60_000 },
      };
      expect(msg.type).toBe('heartbeat');
      expect(msg.payload.uptimeMs).toBe(60_000);
    });

    it('heartbeat can include optional memory usage', () => {
      const msg: HeartbeatMessage = {
        type: 'heartbeat',
        timestamp: now,
        payload: { projectId: 'proj-1', uptimeMs: 60_000, memoryUsageMb: 128 },
      };
      expect(msg.payload.memoryUsageMb).toBe(128);
    });

    it('status-update message has correct shape', () => {
      const state: ProjectState = {
        initialized: true,
        daemonOnline: true,
        workState: 'working',
      };
      const msg: StatusUpdateMessage = {
        type: 'status-update',
        timestamp: now,
        payload: { projectId: 'proj-1', state },
      };
      expect(msg.type).toBe('status-update');
      expect(msg.payload.state.workState).toBe('working');
    });

    it('terminal-data message has correct shape', () => {
      const msg: TerminalDataMessage = {
        type: 'terminal-data',
        timestamp: now,
        payload: { projectId: 'proj-1', sessionId: 'term-1', data: 'ls\n' },
      };
      expect(msg.type).toBe('terminal-data');
      expect(msg.payload.data).toBe('ls\n');
    });

    it('copilot-session-update message has correct shape', () => {
      const msg: CopilotSessionUpdateMessage = {
        type: 'copilot-session-update',
        timestamp: now,
        payload: {
          projectId: 'proj-1',
          session: {
            sessionId: 'cs-1',
            state: 'active',
            model: 'gpt-4',
            startedAt: now - 5000,
            lastActivityAt: now,
          },
        },
      };
      expect(msg.type).toBe('copilot-session-update');
      expect(msg.payload.session.state).toBe('active');
    });

    it('copilot-conversation message has correct shape', () => {
      const msg: CopilotConversationMessage = {
        type: 'copilot-conversation',
        timestamp: now,
        payload: {
          projectId: 'proj-1',
          sessionId: 'cs-1',
          messages: [
            { role: 'user', content: 'hello', timestamp: now },
            { role: 'assistant', content: 'hi there', timestamp: now + 1 },
          ],
        },
      };
      expect(msg.type).toBe('copilot-conversation');
      expect(msg.payload.messages).toHaveLength(2);
    });

    it('attention-item message has correct shape', () => {
      const msg: AttentionItemMessage = {
        type: 'attention-item',
        timestamp: now,
        payload: {
          projectId: 'proj-1',
          item: {
            id: 'att-1',
            severity: 'warning',
            title: 'Build failed',
            detail: 'exit code 1',
            source: 'terminal',
            timestamp: now,
          },
        },
      };
      expect(msg.type).toBe('attention-item');
      expect(msg.payload.item.severity).toBe('warning');
    });

    it('auth-response message has correct shape', () => {
      const msg: AuthResponseMessage = {
        type: 'auth-response',
        timestamp: now,
        payload: { projectId: 'proj-1', token: 'abc123', nonce: 'nonce-xyz' },
      };
      expect(msg.type).toBe('auth-response');
      expect(msg.payload.nonce).toBe('nonce-xyz');
    });
  });

  describe('HQ → Daemon messages', () => {
    it('auth-challenge message has correct shape', () => {
      const msg: AuthChallengeMessage = {
        type: 'auth-challenge',
        timestamp: now,
        payload: { nonce: 'challenge-nonce' },
      };
      expect(msg.type).toBe('auth-challenge');
      expect(msg.payload.nonce).toBe('challenge-nonce');
    });

    it('auth-accept message has correct shape', () => {
      const msg: AuthAcceptMessage = {
        type: 'auth-accept',
        timestamp: now,
        payload: { message: 'Welcome' },
      };
      expect(msg.type).toBe('auth-accept');
    });

    it('auth-reject message has correct shape', () => {
      const msg: AuthRejectMessage = {
        type: 'auth-reject',
        timestamp: now,
        payload: { reason: 'Invalid token' },
      };
      expect(msg.type).toBe('auth-reject');
      expect(msg.payload.reason).toBe('Invalid token');
    });

    it('command message has correct shape', () => {
      const msg: CommandMessage = {
        type: 'command',
        timestamp: now,
        payload: {
          projectId: 'proj-1',
          action: 'inject-prompt',
          args: { prompt: 'fix the tests' },
        },
      };
      expect(msg.type).toBe('command');
      expect(msg.payload.action).toBe('inject-prompt');
    });

    it('command message works without optional args', () => {
      const msg: CommandMessage = {
        type: 'command',
        timestamp: now,
        payload: { projectId: 'proj-1', action: 'restart' },
      };
      expect(msg.payload.args).toBeUndefined();
    });

    it('terminal-input message has correct shape', () => {
      const msg: TerminalInputMessage = {
        type: 'terminal-input',
        timestamp: now,
        payload: { projectId: 'proj-1', sessionId: 'term-1', data: 'cd /app\n' },
      };
      expect(msg.type).toBe('terminal-input');
      expect(msg.payload.data).toBe('cd /app\n');
    });

    it('request-status message has correct shape', () => {
      const msg: RequestStatusMessage = {
        type: 'request-status',
        timestamp: now,
        payload: { projectId: 'proj-1' },
      };
      expect(msg.type).toBe('request-status');
    });
  });

  describe('Discriminated union', () => {
    it('WsMessage discriminates on type field', () => {
      const msg: WsMessage = {
        type: 'heartbeat',
        timestamp: now,
        payload: { projectId: 'p', uptimeMs: 0 },
      };

      // Narrow via switch
      switch (msg.type) {
        case 'heartbeat':
          expect(msg.payload.uptimeMs).toBe(0);
          break;
        default:
          expect.unreachable('Should have matched heartbeat');
      }
    });

    it('DaemonToHqMessage union contains all daemon message types', () => {
      const types: DaemonToHqMessage['type'][] = [
        'register',
        'heartbeat',
        'status-update',
        'terminal-data',
        'copilot-session-update',
        'copilot-conversation',
        'attention-item',
        'auth-response',
      ];
      expect(types).toHaveLength(8);
    });

    it('HqToDaemonMessage union contains all HQ message types', () => {
      const types: HqToDaemonMessage['type'][] = [
        'auth-challenge',
        'auth-accept',
        'auth-reject',
        'command',
        'terminal-input',
        'request-status',
      ];
      expect(types).toHaveLength(6);
    });
  });

  describe('Domain types', () => {
    it('RuntimeTarget accepts valid values', () => {
      const targets: RuntimeTarget[] = ['wsl-devcontainer', 'wsl', 'local'];
      expect(targets).toHaveLength(3);
    });

    it('WorkState accepts valid values', () => {
      const states: WorkState[] = ['working', 'awaiting', 'stopped'];
      expect(states).toHaveLength(3);
    });

    it('DaemonInfo includes all required fields', () => {
      const info: DaemonInfo = {
        projectId: 'p1',
        projectName: 'test',
        runtimeTarget: 'local',
        capabilities: [],
        version: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
      };
      expect(info.protocolVersion).toBe(PROTOCOL_VERSION);
    });

    it('MessageType covers all discriminants', () => {
      const allTypes: MessageType[] = [
        'register', 'heartbeat', 'status-update', 'terminal-data',
        'copilot-session-update', 'copilot-conversation', 'attention-item',
        'auth-response', 'auth-challenge', 'auth-accept', 'auth-reject',
        'command', 'terminal-input', 'request-status',
      ];
      expect(allTypes).toHaveLength(14);
    });
  });
});
