import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadDaemonConfig, readConfigFile } from '../config.js';

// Mock fs for config file tests
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
  };
});

import { existsSync, readFileSync } from 'node:fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('daemon/config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('loadDaemonConfig', () => {
    it('reads from environment variables', () => {
      process.env.LAUNCHPAD_HQ_URL = 'ws://hq.test:4000';
      process.env.LAUNCHPAD_DAEMON_TOKEN = 'test-token-123';
      process.env.LAUNCHPAD_PROJECT_ID = 'proj-1';
      process.env.LAUNCHPAD_PROJECT_NAME = 'my-project';

      const config = loadDaemonConfig();

      expect(config.hqUrl).toBe('ws://hq.test:4000');
      expect(config.token).toBe('test-token-123');
      expect(config.projectId).toBe('proj-1');
      expect(config.projectName).toBe('my-project');
    });

    it('uses overrides over env vars', () => {
      process.env.LAUNCHPAD_DAEMON_TOKEN = 'env-token';
      process.env.LAUNCHPAD_PROJECT_ID = 'env-id';

      const config = loadDaemonConfig({
        token: 'override-token',
        projectId: 'override-id',
      });

      expect(config.token).toBe('override-token');
      expect(config.projectId).toBe('override-id');
    });

    it('falls back to config file when env vars missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          hq: 'ws://file-hq:5000',
          token: 'file-token',
          project: { id: 'file-id', name: 'file-project', path: '/workspace/proj' },
        }),
      );

      const config = loadDaemonConfig();

      expect(config.hqUrl).toBe('ws://file-hq:5000');
      expect(config.token).toBe('file-token');
      expect(config.projectId).toBe('file-id');
      expect(config.projectName).toBe('file-project');
      expect(config.projectPath).toBe('/workspace/proj');
    });

    it('uses default HQ URL when not specified', () => {
      const config = loadDaemonConfig({
        token: 'tok',
        projectId: 'id',
      });

      expect(config.hqUrl).toBe('ws://localhost:3000');
    });

    it('infers project name from cwd when not specified', () => {
      const config = loadDaemonConfig({
        token: 'tok',
        projectId: 'id',
      });

      expect(config.projectName).toBeTruthy();
      expect(typeof config.projectName).toBe('string');
    });

    it('throws when token is missing', () => {
      process.env.LAUNCHPAD_PROJECT_ID = 'proj-1';

      expect(() => loadDaemonConfig()).toThrow('Daemon token is required');
    });

    it('throws when project ID is missing', () => {
      process.env.LAUNCHPAD_DAEMON_TOKEN = 'tok';

      expect(() => loadDaemonConfig()).toThrow('Project ID is required');
    });

    it('env vars take priority over config file', () => {
      process.env.LAUNCHPAD_DAEMON_TOKEN = 'env-token';
      process.env.LAUNCHPAD_PROJECT_ID = 'env-id';

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          token: 'file-token',
          project: { id: 'file-id' },
        }),
      );

      const config = loadDaemonConfig();

      expect(config.token).toBe('env-token');
      expect(config.projectId).toBe('env-id');
    });
  });

  describe('readConfigFile', () => {
    it('returns null when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(readConfigFile('/some/path')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not-json');

      expect(readConfigFile('/some/path')).toBeNull();
    });

    it('parses valid config file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ hq: 'ws://test:3000' }));

      const result = readConfigFile('/some/path');

      expect(result).toEqual({ hq: 'ws://test:3000' });
    });
  });
});
