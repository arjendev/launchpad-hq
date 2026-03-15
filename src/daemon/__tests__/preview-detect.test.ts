import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectPreviewPort } from '../preview-detect.js';

// Mock fs for controlled file reads
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
  };
});

// Mock net to control port scan results
vi.mock('node:net', async () => {
  const actual = await vi.importActual<typeof import('node:net')>('node:net');
  return {
    ...actual,
    createConnection: vi.fn(() => {
      const { EventEmitter } = require('node:events');
      const ee = new EventEmitter();
      ee.destroy = vi.fn();
      // Simulate connection error by default (no port open)
      setTimeout(() => ee.emit('error', new Error('ECONNREFUSED')), 10);
      return ee;
    }),
  };
});

import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockCreateConnection = vi.mocked(createConnection);

describe('detectPreviewPort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('devcontainer.json detection', () => {
    it('reads forwardPorts from .devcontainer/devcontainer.json', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).includes('.devcontainer/devcontainer.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        forwardPorts: [3000, 5173],
      }));

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 3000, source: 'devcontainer' });
    });

    it('reads forwardPorts from .devcontainer.json at root', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).endsWith('.devcontainer.json') && !String(path).includes('.devcontainer/');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        forwardPorts: [8080],
      }));

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 8080, source: 'devcontainer' });
    });

    it('handles devcontainer.json with comments', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).includes('.devcontainer/devcontainer.json');
      });
      mockReadFileSync.mockReturnValue(`{
        // Forward the dev server port
        "forwardPorts": [4200],
        /* Build config */
        "build": {}
      }`);

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 4200, source: 'devcontainer' });
    });

    it('handles devcontainer.json with trailing commas', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).includes('.devcontainer/devcontainer.json');
      });
      mockReadFileSync.mockReturnValue(`{
        // Forward the dev server port
        "forwardPorts": [3000],
        "build": {},
      }`);

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 3000, source: 'devcontainer' });
    });

    it('preserves URLs with // inside strings', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).includes('.devcontainer/devcontainer.json');
      });
      mockReadFileSync.mockReturnValue(`{
        "image": "ghcr.io//myimage:latest",
        "forwardPorts": [5173]
      }`);

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 5173, source: 'devcontainer' });
    });

    it('skips invalid devcontainer.json', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).includes('.devcontainer/devcontainer.json');
      });
      mockReadFileSync.mockReturnValue('not valid json');

      const result = await detectPreviewPort('/project');

      expect(result).toBeNull();
    });

    it('skips empty forwardPorts array', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).includes('.devcontainer/devcontainer.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ forwardPorts: [] }));

      const result = await detectPreviewPort('/project');

      expect(result).toBeNull();
    });
  });

  describe('package.json heuristics', () => {
    it('detects explicit --port flag in dev script', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scripts: { dev: 'vite --port 3333' },
      }));

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 3333, source: 'package-json' });
    });

    it('detects -p short flag', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scripts: { dev: 'next dev -p 4000' },
      }));

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 4000, source: 'package-json' });
    });

    it('detects vite framework default', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scripts: { dev: 'vite' },
      }));

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 5173, source: 'package-json' });
    });

    it('detects next framework default', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scripts: { dev: 'next dev' },
      }));

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 3000, source: 'package-json' });
    });

    it('detects angular ng serve default', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scripts: { start: 'ng serve' },
      }));

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 4200, source: 'package-json' });
    });

    it('detects react-scripts default', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scripts: { start: 'react-scripts start' },
      }));

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 3000, source: 'package-json' });
    });

    it('prefers explicit port over framework default', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scripts: { dev: 'vite --port 9000' },
      }));

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 9000, source: 'package-json' });
    });

    it('skips package.json without scripts', async () => {
      mockExistsSync.mockImplementation((path) => {
        return String(path).endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'test' }));

      const result = await detectPreviewPort('/project');

      expect(result).toBeNull();
    });
  });

  describe('port scan', () => {
    it('returns null when no ports are open', async () => {
      const result = await detectPreviewPort('/project');
      expect(result).toBeNull();
    });

    it('detects an open port', async () => {
      const { EventEmitter } = await import('node:events');
      mockCreateConnection.mockImplementation((_opts: unknown) => {
        const ee = new EventEmitter();
        (ee as unknown as { destroy: () => void }).destroy = vi.fn();
        const opts = _opts as { port: number };
        if (opts.port === 3000) {
          setTimeout(() => ee.emit('connect'), 5);
        } else {
          setTimeout(() => ee.emit('error', new Error('ECONNREFUSED')), 5);
        }
        return ee as ReturnType<typeof createConnection>;
      });

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 3000, source: 'port-scan' });
    });
  });

  describe('priority', () => {
    it('devcontainer takes priority over package.json', async () => {
      // Both devcontainer.json and package.json exist
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        if (String(path).includes('devcontainer')) {
          return JSON.stringify({ forwardPorts: [8000] });
        }
        return JSON.stringify({ scripts: { dev: 'vite' } });
      });

      const result = await detectPreviewPort('/project');

      expect(result).toEqual({ port: 8000, source: 'devcontainer' });
    });
  });
});
