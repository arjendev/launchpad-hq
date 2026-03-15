/**
 * Auto-detection of preview port for a project.
 *
 * Detection order:
 *  1. devcontainer.json forwardPorts
 *  2. package.json script heuristics
 *  3. Port scan on common dev-server ports
 */

import { readFileSync, existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve, join } from 'node:path';

export interface DetectedPort {
  port: number;
  source: 'config' | 'devcontainer' | 'port-scan' | 'package-json';
}

/** Well-known dev server ports in priority order */
const COMMON_PORTS = [5173, 3000, 3001, 4200, 8080, 8000];

/** Well-known framework default ports */
const FRAMEWORK_PORTS: Record<string, number> = {
  vite: 5173,
  next: 3000,
  nuxt: 3000,
  angular: 4200,
  'ng serve': 4200,
  webpack: 8080,
  'react-scripts': 3000,
};

/**
 * Detect the preview port for a project.
 * Returns null if no port can be determined.
 */
export async function detectPreviewPort(projectPath: string): Promise<DetectedPort | null> {
  console.log(`🔍 Preview detect: scanning project at ${projectPath}`);

  // 1. Check devcontainer.json
  const devcontainerPort = readDevcontainerPort(projectPath);
  if (devcontainerPort) {
    console.log(`🔍 Preview detect: auto-detected port ${devcontainerPort.port} from ${devcontainerPort.source}`);
    return devcontainerPort;
  }

  // 2. Check package.json heuristics
  const packagePort = readPackageJsonPort(projectPath);
  if (packagePort) {
    console.log(`🔍 Preview detect: auto-detected port ${packagePort.port} from ${packagePort.source}`);
    return packagePort;
  }

  // 3. Port scan
  console.log(`🔍 Preview detect: no config-based port found, starting port scan on [${COMMON_PORTS.join(', ')}]`);
  const scannedPort = await scanPorts();
  if (scannedPort) {
    console.log(`🔍 Preview detect: auto-detected port ${scannedPort.port} from ${scannedPort.source}`);
    return scannedPort;
  }

  console.log('🔍 Preview detect: no port detected');
  return null;
}

/**
 * Read forwardPorts from devcontainer.json.
 */
function readDevcontainerPort(projectPath: string): DetectedPort | null {
  const candidates = [
    join(projectPath, '.devcontainer', 'devcontainer.json'),
    join(projectPath, '.devcontainer.json'),
  ];

  for (const filePath of candidates) {
    console.log(`🔍 Preview detect: checking devcontainer.json at ${filePath}... ${existsSync(filePath) ? 'found' : 'not found'}`);
    if (!existsSync(filePath)) continue;

    try {
      const raw = readFileSync(filePath, 'utf-8');
      // Strip JSON comments (// and /* */) for devcontainer.json compatibility
      const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const parsed = JSON.parse(cleaned) as { forwardPorts?: unknown[] };

      if (Array.isArray(parsed.forwardPorts) && parsed.forwardPorts.length > 0) {
        console.log(`🔍 Preview detect: parsed forwardPorts = [${parsed.forwardPorts.join(', ')}]`);
        const port = Number(parsed.forwardPorts[0]);
        if (Number.isFinite(port) && port > 0 && port < 65536) {
          return { port, source: 'devcontainer' };
        }
      } else {
        console.log('🔍 Preview detect: devcontainer.json has no forwardPorts');
      }
    } catch {
      console.log(`🔍 Preview detect: failed to parse ${filePath}`);
    }
  }

  return null;
}

/**
 * Parse package.json scripts for port hints.
 */
function readPackageJsonPort(projectPath: string): DetectedPort | null {
  const pkgPath = resolve(projectPath, 'package.json');
  console.log(`🔍 Preview detect: checking package.json at ${pkgPath}... ${existsSync(pkgPath) ? 'found' : 'not found'}`);
  if (!existsSync(pkgPath)) return null;

  try {
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };

    if (!pkg.scripts) {
      console.log('🔍 Preview detect: package.json has no scripts');
      return null;
    }

    // Check dev and start scripts
    const scriptEntries: Array<[string, string]> = [];
    if (pkg.scripts.dev) scriptEntries.push(['dev', pkg.scripts.dev]);
    if (pkg.scripts.start) scriptEntries.push(['start', pkg.scripts.start]);
    const scripts = scriptEntries.map(([, v]) => v);

    console.log(`🔍 Preview detect: examining scripts: ${scriptEntries.map(([k, v]) => `${k}="${v}"`).join(', ') || '(none relevant)'}`);

    for (const script of scripts) {
      // Explicit --port flag (e.g., vite --port 3000, next dev -p 4000)
      const portMatch = script.match(/(?:--port|-p)\s+(\d+)/);
      if (portMatch) {
        const port = Number(portMatch[1]);
        console.log(`🔍 Preview detect: found explicit port flag → ${port}`);
        if (port > 0 && port < 65536) {
          return { port, source: 'package-json' };
        }
      }

      // Framework detection by command name
      for (const [keyword, port] of Object.entries(FRAMEWORK_PORTS)) {
        if (script.includes(keyword)) {
          console.log(`🔍 Preview detect: matched framework "${keyword}" → port ${port}`);
          return { port, source: 'package-json' };
        }
      }
    }

    console.log('🔍 Preview detect: no port hints found in package.json scripts');
  } catch {
    console.log(`🔍 Preview detect: failed to parse ${pkgPath}`);
  }

  return null;
}

/**
 * Scan common dev-server ports for a listening service.
 */
async function scanPorts(): Promise<DetectedPort | null> {
  for (const port of COMMON_PORTS) {
    const open = await isPortOpen(port);
    console.log(`🔍 Preview detect: port scan ${port} → ${open ? 'connected' : 'closed'}`);
    if (open) {
      return { port, source: 'port-scan' };
    }
  }
  return null;
}

/**
 * Check if a port is open on localhost with a short timeout.
 */
function isPortOpen(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}
