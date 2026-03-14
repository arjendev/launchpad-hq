import { describe, it, expect } from 'vitest';
import type {
  ConnectionState,
  SessionEvent,
  SessionEventType,
  SessionMetadata,
} from '@github/copilot-sdk';
import type {
  CopilotAgentCatalogEntry,
  CopilotAgentCatalogMessage,
  SessionConfigWire,
  ToolDefinitionWire,
  CopilotSdkStateMessage,
  CopilotSessionListMessage,
  CopilotSessionEventMessage,
  CopilotCreateSessionMessage,
  CopilotResumeSessionMessage,
  CopilotSendPromptMessage,
  CopilotAbortSessionMessage,
  CopilotListSessionsMessage,
  CopilotModelsListMessage,
  CopilotAuthStatusMessage,
  DaemonToHqMessage,
  HqToDaemonMessage,
  WsMessage,
  MessageType,
} from '../../../shared/protocol.js';

const now = Date.now();

describe('Copilot SDK protocol (big-bang refactor)', () => {
  // -----------------------------------------------------------------------
  // SDK re-exports
  // -----------------------------------------------------------------------

  describe('ConnectionState (SDK)', () => {
    it('accepts all valid states', () => {
      const states: ConnectionState[] = ['disconnected', 'connecting', 'connected', 'error'];
      expect(states).toHaveLength(4);
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
        agentId: 'github:squad',
        systemMessage: { mode: 'append', content: 'Be helpful' },
        tools: [tool],
        streaming: true,
      };
      expect(config.model).toBe('gpt-4');
      expect(config.agentId).toBe('github:squad');
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
    it('has correct message shape with ConnectionState', () => {
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

  describe('Daemon → HQ: copilot-session-list', () => {
    it('carries SDK SessionMetadata[]', () => {
      const sessions: SessionMetadata[] = [
        { sessionId: 'sess-1', startTime: new Date(), modifiedTime: new Date(), isRemote: false, summary: 'Test' },
        { sessionId: 'sess-2', startTime: new Date(), modifiedTime: new Date(), isRemote: false },
      ];
      const msg: CopilotSessionListMessage = {
        type: 'copilot-session-list',
        timestamp: now,
        payload: { projectId: 'proj-1', requestId: 'req-1', sessions },
      };
      expect(msg.type).toBe('copilot-session-list');
      expect(msg.payload.sessions).toHaveLength(2);
    });
  });

  describe('Daemon → HQ: copilot-session-event', () => {
    it('carries SDK SessionEvent as-is', () => {
      const event: SessionEvent = {
        id: 'evt-1',
        timestamp: new Date().toISOString(),
        parentId: null,
        type: 'session.idle',
        data: {},
      } as SessionEvent;

      const msg: CopilotSessionEventMessage = {
        type: 'copilot-session-event',
        timestamp: now,
        payload: { projectId: 'proj-1', sessionId: 'sess-1', event },
      };
      expect(msg.type).toBe('copilot-session-event');
      expect(msg.payload.event.type).toBe('session.idle');
    });
  });

  describe('Daemon → HQ: copilot-agent-catalog', () => {
    it('advertises selectable agents for the project', () => {
      const agents: CopilotAgentCatalogEntry[] = [
        {
          id: 'builtin:default',
          name: 'default',
          displayName: 'Plain session',
          description: 'Standard Copilot session.',
          kind: 'default',
          source: 'builtin',
        },
        {
          id: 'github:squad',
          name: 'squad',
          displayName: 'Squad',
          description: 'Coordinates repo specialists.',
          kind: 'custom',
          source: 'github-agent-file',
          path: '.github/agents/squad.agent.md',
        },
      ];
      const msg: CopilotAgentCatalogMessage = {
        type: 'copilot-agent-catalog',
        timestamp: now,
        payload: { projectId: 'proj-1', agents },
      };
      expect(msg.type).toBe('copilot-agent-catalog');
      expect(msg.payload.agents[1].id).toBe('github:squad');
    });
  });

  describe('Daemon → HQ: copilot-models-list (NEW)', () => {
    it('has correct message shape', () => {
      const msg: CopilotModelsListMessage = {
        type: 'copilot-models-list',
        timestamp: now,
        payload: { models: [] },
      };
      expect(msg.type).toBe('copilot-models-list');
    });
  });

  describe('Daemon → HQ: copilot-auth-status (NEW)', () => {
    it('has correct message shape', () => {
      const msg: CopilotAuthStatusMessage = {
        type: 'copilot-auth-status',
        timestamp: now,
        payload: { authenticated: true, user: 'octocat' },
      };
      expect(msg.type).toBe('copilot-auth-status');
      expect(msg.payload.user).toBe('octocat');
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
    it('DaemonToHqMessage includes SDK-backed types', () => {
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

    it('DaemonToHqMessage includes new message types', () => {
      const types: DaemonToHqMessage['type'][] = [
        'copilot-session-list',
        'copilot-session-event',
        'copilot-agent-catalog',
        'copilot-sdk-state',
        'copilot-models-list',
        'copilot-auth-status',
      ];
      expect(types).toHaveLength(6);
    });

    it('HqToDaemonMessage includes copilot command types', () => {
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
      const event: SessionEvent = {
        id: 'e1',
        timestamp: new Date().toISOString(),
        parentId: null,
        type: 'session.idle',
        data: {},
      } as SessionEvent;

      const msg: WsMessage = {
        type: 'copilot-session-event',
        timestamp: now,
        payload: { projectId: 'proj-1', sessionId: 's1', event },
      };

      if (msg.type === 'copilot-session-event') {
        expect(msg.payload.sessionId).toBe('s1');
      }
    });

    it('MessageType includes all discriminants', () => {
      const newTypes: MessageType[] = [
        'copilot-sdk-state',
        'copilot-session-list',
        'copilot-session-event',
        'copilot-agent-catalog',
        'copilot-models-list',
        'copilot-auth-status',
        'copilot-create-session',
        'copilot-resume-session',
        'copilot-send-prompt',
        'copilot-abort-session',
        'copilot-list-sessions',
      ];
      expect(newTypes).toHaveLength(11);
    });
  });
});
