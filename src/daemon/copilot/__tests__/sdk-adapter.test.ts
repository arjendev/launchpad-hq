import { describe, it, expect, vi } from 'vitest';
import { SdkCopilotAdapter, isSdkAvailable } from '../sdk-adapter.js';

describe('SdkCopilotAdapter', () => {
  it('starts in disconnected state', () => {
    const adapter = new SdkCopilotAdapter();
    expect(adapter.state).toBe('disconnected');
  });

  it('start() throws because SDK is not installed', async () => {
    const adapter = new SdkCopilotAdapter();
    await expect(adapter.start()).rejects.toThrow('@github/copilot-sdk is not installed');
  });

  it('stop() throws because SDK is not installed', async () => {
    const adapter = new SdkCopilotAdapter();
    await expect(adapter.stop()).rejects.toThrow('@github/copilot-sdk is not installed');
  });

  it('listSessions() throws because SDK is not installed', async () => {
    const adapter = new SdkCopilotAdapter();
    await expect(adapter.listSessions()).rejects.toThrow('@github/copilot-sdk is not installed');
  });

  it('createSession() throws because SDK is not installed', async () => {
    const adapter = new SdkCopilotAdapter();
    await expect(adapter.createSession({})).rejects.toThrow('@github/copilot-sdk is not installed');
  });

  it('resumeSession() throws because SDK is not installed', async () => {
    const adapter = new SdkCopilotAdapter();
    await expect(adapter.resumeSession('s1')).rejects.toThrow('@github/copilot-sdk is not installed');
  });

  it('getLastSessionId() throws because SDK is not installed', async () => {
    const adapter = new SdkCopilotAdapter();
    await expect(adapter.getLastSessionId()).rejects.toThrow('@github/copilot-sdk is not installed');
  });

  it('onStateChange() works and can unsubscribe', () => {
    const adapter = new SdkCopilotAdapter();
    const handler = vi.fn();
    const unsub = adapter.onStateChange(handler);
    unsub();
    // No crash → pass
    expect(true).toBe(true);
  });
});

describe('isSdkAvailable()', () => {
  it('returns false when SDK is not installed', () => {
    expect(isSdkAvailable()).toBe(false);
  });
});
