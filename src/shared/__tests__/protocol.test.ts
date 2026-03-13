import { describe, it, expect } from 'vitest';
import type {
  WsMessage,
  DaemonToHqMessage,
  HqToDaemonMessage,
  RegisterMessage,
  HeartbeatMessage,
  StatusUpdateMessage,
  TerminalDataMessage,
  TerminalExitMessage,
  CopilotConversationMessage,
  CopilotSessionListMessage,
  CopilotSessionEventMessage,
  CopilotSdkStateMessage,
  CopilotModelsListMessage,
  CopilotAuthStatusMessage,
  AttentionItemMessage,
  AuthResponseMessage,
  AuthChallengeMessage,
  AuthAcceptMessage,
  AuthRejectMessage,
  CommandMessage,
  TerminalInputMessage,
  TerminalSpawnMessage,
  TerminalResizeMessage,
  TerminalKillMessage,
  RequestStatusMessage,
  CopilotCreateSessionMessage,
  CopilotResumeSessionMessage,
  CopilotSendPromptMessage,
  CopilotAbortSessionMessage,
  CopilotListSessionsMessage,
  CopilotToolInvocationMessage,
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

    it('terminal-exit message has correct shape', () => {
      const msg: TerminalExitMessage = {
        type: 'terminal-exit',
        timestamp: now,
        payload: { projectId: 'proj-1', terminalId: 'term-1', exitCode: 0 },
      };
      expect(msg.type).toBe('terminal-exit');
      expect(msg.payload.exitCode).toBe(0);
    });

    it('copilot-session-list message has correct shape', () => {
      const msg: CopilotSessionListMessage = {
        type: 'copilot-session-list',
        timestamp: now,
        payload: {
          projectId: 'proj-1',
          requestId: 'req-1',
          sessions: [],
        },
      };
      expect(msg.type).toBe('copilot-session-list');
    });

    it('copilot-session-event message has correct shape', () => {
      const msg: CopilotSessionEventMessage = {
        type: 'copilot-session-event',
        timestamp: now,
        payload: {
          projectId: 'proj-1',
          sessionId: 'cs-1',
          event: { id: 'e1', timestamp: new Date().toISOString(), parentId: null, type: 'session.idle', data: {} } as never,
        },
      };
      expect(msg.type).toBe('copilot-session-event');
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

    it('terminal-spawn message has correct shape', () => {
      const msg: TerminalSpawnMessage = {
        type: 'terminal-spawn',
        timestamp: now,
        payload: { projectId: 'proj-1', terminalId: 'term-1', cols: 120, rows: 40 },
      };
      expect(msg.type).toBe('terminal-spawn');
      expect(msg.payload.terminalId).toBe('term-1');
      expect(msg.payload.cols).toBe(120);
    });

    it('terminal-spawn works without optional cols/rows', () => {
      const msg: TerminalSpawnMessage = {
        type: 'terminal-spawn',
        timestamp: now,
        payload: { projectId: 'proj-1', terminalId: 'term-2' },
      };
      expect(msg.payload.cols).toBeUndefined();
      expect(msg.payload.rows).toBeUndefined();
    });

    it('terminal-resize message has correct shape', () => {
      const msg: TerminalResizeMessage = {
        type: 'terminal-resize',
        timestamp: now,
        payload: { projectId: 'proj-1', terminalId: 'term-1', cols: 200, rows: 50 },
      };
      expect(msg.type).toBe('terminal-resize');
      expect(msg.payload.cols).toBe(200);
    });

    it('terminal-kill message has correct shape', () => {
      const msg: TerminalKillMessage = {
        type: 'terminal-kill',
        timestamp: now,
        payload: { projectId: 'proj-1', terminalId: 'term-1' },
      };
      expect(msg.type).toBe('terminal-kill');
      expect(msg.payload.terminalId).toBe('term-1');
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
        'terminal-exit',
        'copilot-session-list',
        'copilot-session-event',
        'copilot-conversation',
        'copilot-sdk-state',
        'copilot-models-list',
        'copilot-auth-status',
        'attention-item',
        'copilot-tool-invocation',
        'auth-response',
      ];
      expect(types).toHaveLength(14);
    });

    it('HqToDaemonMessage union contains all HQ message types', () => {
      const types: HqToDaemonMessage['type'][] = [
        'auth-challenge',
        'auth-accept',
        'auth-reject',
        'command',
        'terminal-input',
        'terminal-spawn',
        'terminal-resize',
        'terminal-kill',
        'request-status',
        'copilot-create-session',
        'copilot-resume-session',
        'copilot-send-prompt',
        'copilot-abort-session',
        'copilot-list-sessions',
      ];
      expect(types).toHaveLength(14);
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
        'register', 'heartbeat', 'status-update', 'terminal-data', 'terminal-exit',
        'copilot-session-list', 'copilot-session-event', 'copilot-conversation',
        'copilot-sdk-state', 'copilot-models-list', 'copilot-auth-status',
        'copilot-tool-invocation',
        'attention-item', 'auth-response',
        'auth-challenge', 'auth-accept', 'auth-reject',
        'command', 'terminal-input', 'terminal-spawn', 'terminal-resize',
        'terminal-kill', 'request-status',
        'copilot-create-session', 'copilot-resume-session', 'copilot-send-prompt',
        'copilot-abort-session', 'copilot-list-sessions',
      ];
      expect(allTypes).toHaveLength(28);
    });
  });
});
