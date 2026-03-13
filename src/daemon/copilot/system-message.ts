/**
 * System message template for HQ-aware Copilot sessions.
 *
 * Appended to every session to instruct the agent about the
 * available HQ communication tools.
 */

export function buildSystemMessage(
  projectId: string,
  projectName?: string,
): { mode: 'append'; content: string } {
  return {
    mode: 'append',
    content: `You are working on the project "${projectName || projectId}" managed by launchpad-hq.
You have access to these additional tools for communicating with the human operator:
- report_progress: Report your current task status and progress summary
- request_human_review: Request human attention when you need a decision or review
- report_blocker: Signal that you are blocked and cannot proceed
Use these tools proactively to keep the operator informed of your progress.`,
  };
}
