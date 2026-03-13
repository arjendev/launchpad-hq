import { describe, it, expect } from 'vitest';
import { buildSystemMessage } from '../system-message.js';

describe('buildSystemMessage', () => {
  it('returns mode "append"', () => {
    const result = buildSystemMessage('proj-1');
    expect(result.mode).toBe('append');
  });

  it('includes project name when provided', () => {
    const result = buildSystemMessage('proj-1', 'My Project');
    expect(result.content).toContain('My Project');
  });

  it('falls back to projectId when projectName is not provided', () => {
    const result = buildSystemMessage('proj-42');
    expect(result.content).toContain('proj-42');
  });

  it('mentions all three tool names', () => {
    const result = buildSystemMessage('proj-1');
    expect(result.content).toContain('report_progress');
    expect(result.content).toContain('request_human_review');
    expect(result.content).toContain('report_blocker');
  });

  it('mentions launchpad-hq', () => {
    const result = buildSystemMessage('proj-1');
    expect(result.content).toContain('launchpad-hq');
  });

  it('instructs proactive tool usage', () => {
    const result = buildSystemMessage('proj-1');
    expect(result.content).toContain('proactively');
  });
});
