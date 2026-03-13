import { describe, it, expect } from 'vitest';
import type {
  CopilotSdkState,
  CopilotSdkSessionInfo,
  CopilotSessionEvent,
  CopilotSessionEventType,
  SessionConfigWire,
  ToolDefinitionWire,
  CopilotSdkStateMessage,
  CopilotSdkSessionListMessage,
  CopilotSdkSessionEventMessage,
  CopilotCreateSessionMessage,
  CopilotResumeSessionMessage,
  CopilotSendPromptMessage,
  CopilotAbortSessionMessage,
  CopilotListSessionsMessage,
  DaemonToHqMessage,
  HqToDaemonMessage,
  WsMessage,
  MessageType,
} from '../../../shared/protocol.js';

const now = Date.now();

describe('Copilot SDK protocol extensions', () => {
  // -----------------------------------------------------------------------
  // Shared types
  // -----------------------------------------------------------------------

  describe('CopilotSdkState', () => {
    it('accepts all valid states', () => {
      const states: CopilotSdkState[] = ['disconnected', 'connecting', 'connected', 'error'];
      expect(states).toHaveLength(4);
    });
  });

  describe('CopilotSdkSessionInfo', () => {
    it('has correct shape with optional fields', () => {
      const info: CopilotSdkSessionInfo = {
        sessionId: 'sess-1',
        cwd: '/ws/project',
        gitRoot: '/ws/project',
        repository: 'org/repo',
        branch: 'main',
        summary: 'Working on feature X',
      };
      expect(info.sessionId).toBe('sess-1');
      expect(info.repository).toBe('org/repo');
    });

    it('works with only required fields', () => {
      const info: CopilotSdkSessionInfo = { sessionId: 'sess-2' };
      expect(info.sessionId).toBe('sess-2');
      expect(info.cwd).toBeUndefined();
    });
  });

  describe('CopilotSessionEvent', () => {
    it('has correct shape', () => {
      const event: CopilotSessionEvent = {
        type: 'assistant.message.delta',
        data: { delta: 'hello ' },
        timestamp: now,
      };
      expect(event.type).toBe('assistant.message.delta');
      expect(event.data.delta).toBe('hello ');
    });

    it('accepts all event types', () => {
      const types: CopilotSessionEventType[] = [
        'user.message',
        'assistant.message',
        'assistant.message.delta',
        'assistant.reasoning',
        'assistant.reasoning.delta',
        'tool.executionStart',
        'tool.executionComplete',
        'session.start',
        'session.idle',
        'session.error',
      ];
      expect(types).toHaveLength(10);
    });
  });

  describe('SessionConfigWire', () => {
    it('has correct shape with all fields', () => {
      const tool: ToolDefinitionWire = {
        name: 'search',
        description: 'Search files',
        parameters: { query: { type: 'string' } },
      };
      const config: SessionConfigWire = {
        model: 'gpt-4',
        systemMessage: { mode: 'append', content: 'Be helpful' },
        tools: [tool],
        streaming: true,
      };
      expect(config.model).toBe('gpt-4');
      expect(config.tools).toHaveLength(1);
    });

    it('works with no fields (all optional)', () => {
      const config: SessionConfigWire = {};
      expect(config.model).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Daemon → HQ messages
  // -----------------------------------------------------------------------

  describe('Daemon → HQ: copilot-sdk-state', () => {
    it('has correct message shape', () => {
      const msg: CopilotSdkStateMessage = {
        type: 'copilot-sdk-state',
        timestamp: now,
        payload: { state: 'connected' },
      };
      expect(msg.type).toBe('copilot-sdk-state');
      expect(msg.payload.state).toBe('connected');
    });

    it('supports optional error field', () => {
      const msg: CopilotSdkStateMessage = {
        type: 'copilot-sdk-state',
        timestamp: now,
        payload: { state: 'error', error: 'Connection refused' },
      };
      expect(msg.payload.error).toBe('Connection refused');
    });
  });

  describe('Daemon → HQ: copilot-sdk-session-list', () => {
    it('has correct message shape', () => {
      const msg: CopilotSdkSessionListMessage = {
        type: 'copilot-sdk-session-list',
        timestamp: now,
        payload: {
          requestId: 'req-1',
          sessions: [
            { sessionId: 'sess-1', repository: 'org/repo' },
            { sessionId: 'sess-2', branch: 'main' },
          ],
        },
      };
      expect(msg.type).toBe('copilot-sdk-session-list');
      expect(msg.payload.sessions).toHaveLength(2);
    });
  });

  describe('Daemon → HQ: copilot-sdk-session-event', () => {
    it('has correct message shape', () => {
      const msg: CopilotSdkSessionEventMessage = {
        type: 'copilot-sdk-session-event',
        timestamp: now,
        payload: {
          sessionId: 'sess-1',
          event: {
            type: 'assistant.message.delta',
            data: { delta: 'Hello' },
            timestamp: now,
          },
        },
      };
      expect(msg.type).toBe('copilot-sdk-session-event');
      expect(msg.payload.event.type).toBe('assistant.message.delta');
    });
  });

  // -----------------------------------------------------------------------
  // HQ → Daemon messages
  // -----------------------------------------------------------------------

  describe('HQ → Daemon: copilot-create-session', () => {
    it('has correct message shape', () => {
      const msg: CopilotCreateSessionMessage = {
        type: 'copilot-create-session',
        timestamp: now,
        payload: {
          requestId: 'req-1',
          config: { model: 'gpt-4', streaming: true },
        },
      };
      expect(msg.type).toBe('copilot-create-session');
      expect(msg.payload.requestId).toBe('req-1');
    });

    it('works without config', () => {
      const msg: CopilotCreateSessionMessage = {
        type: 'copilot-create-session',
        timestamp: now,
        payload: { requestId: 'req-2' },
      };
      expect(msg.payload.config).toBeUndefined();
    });
  });

  describe('HQ → Daemon: copilot-resume-session', () => {
    it('has correct message shape', () => {
      const msg: CopilotResumeSessionMessage = {
        type: 'copilot-resume-session',
        timestamp: now,
        payload: {
          requestId: 'req-3',
          sessionId: 'sess-1',
          config: { model: 'gpt-4' },
        },
      };
      expect(msg.type).toBe('copilot-resume-session');
      expect(msg.payload.sessionId).toBe('sess-1');
    });
  });

  describe('HQ → Daemon: copilot-send-prompt', () => {
    it('has correct message shape', () => {
      const msg: CopilotSendPromptMessage = {
        type: 'copilot-send-prompt',
        timestamp: now,
        payload: {
          sessionId: 'sess-1',
          prompt: 'Fix the tests',
          attachments: [{ type: 'file', path: '/src/main.ts' }],
        },
      };
      expect(msg.type).toBe('copilot-send-prompt');
      expect(msg.payload.prompt).toBe('Fix the tests');
      expect(msg.payload.attachments).toHaveLength(1);
    });

    it('works without attachments', () => {
      const msg: CopilotSendPromptMessage = {
        type: 'copilot-send-prompt',
        timestamp: now,
        payload: { sessionId: 'sess-1', prompt: 'Hello' },
      };
      expect(msg.payload.attachments).toBeUndefined();
    });
  });

  describe('HQ → Daemon: copilot-abort-session', () => {
    it('has correct message shape', () => {
      const msg: CopilotAbortSessionMessage = {
        type: 'copilot-abort-session',
        timestamp: now,
        payload: { sessionId: 'sess-1' },
      };
      expect(msg.type).toBe('copilot-abort-session');
    });
  });

  describe('HQ → Daemon: copilot-list-sessions', () => {
    it('has correct message shape', () => {
      const msg: CopilotListSessionsMessage = {
        type: 'copilot-list-sessions',
        timestamp: now,
        payload: { requestId: 'req-4' },
      };
      expect(msg.type).toBe('copilot-list-sessions');
    });
  });

  // -----------------------------------------------------------------------
  // Union membership
  // -----------------------------------------------------------------------

  describe('discriminated union membership', () => {
    it('DaemonToHqMessage includes new SDK types', () => {
      const msg: DaemonToHqMessage = {
        type: 'copilot-sdk-state',
        timestamp: now,
        payload: { state: 'connected' },
      };

      switch (msg.type) {
        case 'copilot-sdk-state':
          expect(msg.payload.state).toBe('connected');
          break;
        default:
          expect.unreachable('Should match copilot-sdk-state');
      }
    });

    it('HqToDaemonMessage includes new SDK command types', () => {
      const types: HqToDaemonMessage['type'][] = [
        'copilot-create-session',
        'copilot-resume-session',
        'copilot-send-prompt',
        'copilot-abort-session',
        'copilot-list-sessions',
      ];
      expect(types).toHaveLength(5);
    });

    it('WsMessage narrows correctly', () => {
      const msg: WsMessage = {
        type: 'copilot-sdk-session-event',
        timestamp: now,
        payload: {
          sessionId: 's1',
          event: { type: 'session.idle', data: {}, timestamp: now },
        },
      };

      if (msg.type === 'copilot-sdk-session-event') {
        expect(msg.payload.sessionId).toBe('s1');
      }
    });

    it('MessageType includes all new discriminants', () => {
      const newTypes: MessageType[] = [
        'copilot-sdk-state',
        'copilot-sdk-session-list',
        'copilot-sdk-session-event',
        'copilot-create-session',
        'copilot-resume-session',
        'copilot-send-prompt',
        'copilot-abort-session',
        'copilot-list-sessions',
      ];
      expect(newTypes).toHaveLength(8);
    });
  });
});
