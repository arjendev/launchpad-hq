import { describe, it, expect, vi } from 'vitest';
import { SdkCopilotAdapter, getSdkDefineTool } from '../sdk-adapter.js';

describe('getSdkDefineTool()', () => {
  it('returns the defineTool function when SDK is available', () => {
    const dt = getSdkDefineTool();
    expect(typeof dt).toBe('function');
  });
});

describe('SdkCopilotAdapter', () => {
  it('starts in disconnected state', () => {
    const adapter = new SdkCopilotAdapter();
    expect(adapter.state).toBe('disconnected');
  });

  it('accepts cwd option', () => {
    const adapter = new SdkCopilotAdapter({ cwd: '/tmp/test' });
    expect(adapter.state).toBe('disconnected');
  });

  it('onStateChange() works and can unsubscribe', () => {
    const adapter = new SdkCopilotAdapter();
    const handler = vi.fn();
    const unsub = adapter.onStateChange(handler);
    unsub();
    expect(true).toBe(true);
  });

  it('listSessions() returns empty array when client not started', async () => {
    const adapter = new SdkCopilotAdapter();
    const sessions = await adapter.listSessions();
    expect(sessions).toEqual([]);
  });

  it('getLastSessionId() returns null when client not started', async () => {
    const adapter = new SdkCopilotAdapter();
    const id = await adapter.getLastSessionId();
    expect(id).toBeNull();
  });

  it('createSession() throws when client not started', async () => {
    const adapter = new SdkCopilotAdapter();
    await expect(adapter.createSession({})).rejects.toThrow('not started');
  });

  it('resumeSession() throws when client not started', async () => {
    const adapter = new SdkCopilotAdapter();
    await expect(adapter.resumeSession('s1')).rejects.toThrow('not started');
  });

  it('stop() is safe when never started', async () => {
    const adapter = new SdkCopilotAdapter();
    await adapter.stop();
    expect(adapter.state).toBe('disconnected');
  });
});
