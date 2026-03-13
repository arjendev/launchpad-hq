/**
 * Custom HQ-aware tool definitions for Copilot sessions.
 *
 * These tools allow a Copilot agent to communicate with the
 * human operator at HQ — reporting progress, requesting review,
 * and signaling blockers.
 *
 * Uses the SDK's `defineTool()` for proper registration.
 */

import type { Tool } from '@github/copilot-sdk';
import type { DaemonToHqMessage, CopilotHqToolName } from '../../shared/protocol.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkDefineTool: any = null;
try {
  const sdk = await import('@github/copilot-sdk');
  sdkDefineTool = sdk.defineTool;
} catch {
  // SDK not available — tools will be plain objects
}

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
      handler: async (args: Record<string, unknown>) => {
        sendToolInvocation('unknown', 'report_progress', args);
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
      handler: async (args: Record<string, unknown>) => {
        sendToolInvocation('unknown', 'request_human_review', args);
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
      handler: async (args: Record<string, unknown>) => {
        sendToolInvocation('unknown', 'report_blocker', args);
        return { acknowledged: true, message: 'Blocker reported to operator.' };
      },
    },
  ] as const;

  // Use SDK's defineTool when available for proper registration
  if (sdkDefineTool) {
    return toolSpecs.map((spec) =>
      sdkDefineTool(spec.name, {
        description: spec.description,
        parameters: spec.parameters,
        handler: spec.handler,
      }),
    ) as unknown as Tool[];
  }

  return toolSpecs as unknown as Tool[];
}
