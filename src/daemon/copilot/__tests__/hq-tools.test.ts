import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHqTools } from '../hq-tools.js';
import type { DaemonToHqMessage } from '../../../shared/protocol.js';
import type { ToolDefinition } from '../adapter.js';

describe('createHqTools', () => {
  let sent: DaemonToHqMessage[];
  let sendToHq: (msg: DaemonToHqMessage) => void;
  let tools: ToolDefinition[];

  beforeEach(() => {
    sent = [];
    sendToHq = (msg) => sent.push(msg);
    tools = createHqTools(sendToHq, 'proj-42');
  });

  it('returns exactly 3 tools', () => {
    expect(tools).toHaveLength(3);
  });

  it('has correct tool names', () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['report_progress', 'request_human_review', 'report_blocker']);
  });

  it('each tool has a description', () => {
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
    }
  });

  it('each tool has parameters with required fields', () => {
    for (const tool of tools) {
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties).toBeDefined();
    }
  });

  // ── report_progress ──────────────────────────────────

  describe('report_progress', () => {
    let tool: ToolDefinition;

    beforeEach(() => {
      tool = tools.find((t) => t.name === 'report_progress')!;
    });

    it('has status and summary as required parameters', () => {
      expect(tool.parameters.required).toEqual(['status', 'summary']);
    });

    it('handler sends copilot-tool-invocation message to HQ', async () => {
      const result = await tool.handler({ status: 'working', summary: 'Fixing tests' });

      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('copilot-tool-invocation');
      const msg = sent[0] as DaemonToHqMessage & { type: 'copilot-tool-invocation' };
      expect(msg.tool).toBe('report_progress');
      expect(msg.projectId).toBe('proj-42');
      expect(msg.args).toEqual({ status: 'working', summary: 'Fixing tests' });
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('handler returns acknowledgment', async () => {
      const result = await tool.handler({ status: 'completed', summary: 'Done' });

      expect(result).toEqual({
        acknowledged: true,
        message: 'Progress reported to operator.',
      });
    });
  });

  // ── request_human_review ─────────────────────────────

  describe('request_human_review', () => {
    let tool: ToolDefinition;

    beforeEach(() => {
      tool = tools.find((t) => t.name === 'request_human_review')!;
    });

    it('has reason and urgency as required parameters', () => {
      expect(tool.parameters.required).toEqual(['reason', 'urgency']);
    });

    it('handler sends copilot-tool-invocation message to HQ', async () => {
      await tool.handler({ reason: 'Need approval', urgency: 'high' });

      expect(sent).toHaveLength(1);
      const msg = sent[0] as DaemonToHqMessage & { type: 'copilot-tool-invocation' };
      expect(msg.tool).toBe('request_human_review');
      expect(msg.args).toEqual({ reason: 'Need approval', urgency: 'high' });
    });

    it('handler returns acknowledgment', async () => {
      const result = await tool.handler({ reason: 'Check this', urgency: 'low' });

      expect(result).toEqual({
        acknowledged: true,
        message: 'Review request sent to operator.',
      });
    });
  });

  // ── report_blocker ───────────────────────────────────

  describe('report_blocker', () => {
    let tool: ToolDefinition;

    beforeEach(() => {
      tool = tools.find((t) => t.name === 'report_blocker')!;
    });

    it('has blocker as required parameter', () => {
      expect(tool.parameters.required).toEqual(['blocker']);
    });

    it('handler sends copilot-tool-invocation message to HQ', async () => {
      await tool.handler({
        blocker: 'API key expired',
        attempted: ['regenerate key', 'use cached token'],
      });

      expect(sent).toHaveLength(1);
      const msg = sent[0] as DaemonToHqMessage & { type: 'copilot-tool-invocation' };
      expect(msg.tool).toBe('report_blocker');
      expect(msg.args.blocker).toBe('API key expired');
      expect(msg.args.attempted).toEqual(['regenerate key', 'use cached token']);
    });

    it('handler returns acknowledgment', async () => {
      const result = await tool.handler({ blocker: 'Cannot connect' });

      expect(result).toEqual({
        acknowledged: true,
        message: 'Blocker reported to operator.',
      });
    });
  });
});
