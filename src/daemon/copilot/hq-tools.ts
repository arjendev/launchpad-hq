import { defineTool } from '@github/copilot-sdk';
import type { Tool, ToolInvocation } from '@github/copilot-sdk';
import type { DaemonToHqMessage, CopilotHqToolName } from '../../shared/protocol.js';

type ReportProgressArgs = {
  status: 'working' | 'completed' | 'blocked';
  summary: string;
  details?: string;
};

type RequestHumanReviewArgs = {
  reason: string;
  context?: string;
  urgency: 'low' | 'medium' | 'high';
};

type ReportBlockerArgs = {
  blocker: string;
  attempted?: string[];
};

export function createHqTools(
  sendToHq: (msg: DaemonToHqMessage) => void,
  projectId: string,
): Tool[] {
  function sendToolInvocation(
    sessionId: string,
    tool: CopilotHqToolName,
    args: Record<string, unknown>,
  ): void {
    sendToHq({
      type: 'copilot-tool-invocation',
      sessionId,
      projectId,
      tool,
      args,
      timestamp: Date.now(),
    });
  }

  const toolSpecs = [
    {
      name: 'report_progress',
      description:
        'Report your current task status and progress summary to the human operator at HQ.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['working', 'completed', 'blocked'],
            description: 'Current work state.',
          },
          summary: {
            type: 'string',
            description: 'Brief summary of current progress.',
          },
          details: {
            type: 'string',
            description: 'Optional detailed information.',
          },
        },
        required: ['status', 'summary'],
      },
      handler: async (args: ReportProgressArgs, invocation: ToolInvocation) => {
        sendToolInvocation(invocation.sessionId, 'report_progress', args);
        return { acknowledged: true, message: 'Progress reported to operator.' };
      },
    },
    {
      name: 'request_human_review',
      description:
        'Request human attention when you need a decision or review from the operator.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why human review is needed.',
          },
          context: {
            type: 'string',
            description: 'Optional additional context for the reviewer.',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'How urgent the review request is.',
          },
        },
        required: ['reason', 'urgency'],
      },
      handler: async (args: RequestHumanReviewArgs, invocation: ToolInvocation) => {
        sendToolInvocation(invocation.sessionId, 'request_human_review', args);
        return { acknowledged: true, message: 'Review request sent to operator.' };
      },
    },
    {
      name: 'report_blocker',
      description:
        'Signal that you are blocked and cannot proceed without intervention.',
      parameters: {
        type: 'object',
        properties: {
          blocker: {
            type: 'string',
            description: 'Description of what is blocking progress.',
          },
          attempted: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of solutions already attempted.',
          },
        },
        required: ['blocker'],
      },
      handler: async (args: ReportBlockerArgs, invocation: ToolInvocation) => {
        sendToolInvocation(invocation.sessionId, 'report_blocker', args);
        return { acknowledged: true, message: 'Blocker reported to operator.' };
      },
    },
  ] as const;

  return [
    defineTool<ReportProgressArgs>(toolSpecs[0].name, {
      description: toolSpecs[0].description,
      parameters: toolSpecs[0].parameters,
      handler: toolSpecs[0].handler,
    }),
    defineTool<RequestHumanReviewArgs>(toolSpecs[1].name, {
      description: toolSpecs[1].description,
      parameters: toolSpecs[1].parameters,
      handler: toolSpecs[1].handler,
    }),
    defineTool<ReportBlockerArgs>(toolSpecs[2].name, {
      description: toolSpecs[2].description,
      parameters: toolSpecs[2].parameters,
      handler: toolSpecs[2].handler,
    }),
  ] as Tool[];
}
