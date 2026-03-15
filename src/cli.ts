#!/usr/bin/env node

/**
 * CLI entry point for launchpad-hq.
 *
 * Usage:
 *   launchpad-hq               — start HQ server (default)
 *   launchpad-hq --hq          — start HQ server (explicit)
 *   launchpad-hq --port 8080   — start HQ server on a custom port (1024-65535)
 *   launchpad-hq --self-daemon  — start HQ with built-in daemon
 *   launchpad-hq --daemon      — start daemon mode
 *   launchpad-hq --daemon --watch — start daemon with auto-restart on file changes
 *   launchpad-hq --daemon --preview-port 4000 — daemon with explicit preview port
 *   launchpad-hq --daemon --hq-url ws://localhost:3000 --token <TOKEN> --project-id owner/repo
 */

// Global error handlers — installed early so any crash during startup is logged
process.on('uncaughtException', (err) => {
  console.error('💀 Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('💀 Unhandled rejection:', reason);
  process.exit(1);
});

const args = process.argv.slice(2);

// --help: print usage and exit immediately (before preflight or server boot)
if (args.includes('--help') || args.includes('-h')) {
  console.log(`launchpad-hq — personal mission control for GitHub projects

Usage:
  npx github:arjendev/launchpad-hq               Start HQ server (default port 3000)
  npx github:arjendev/launchpad-hq --port 8080    Start on a custom port (1024-65535)
  npx github:arjendev/launchpad-hq --self-daemon    Start HQ with built-in daemon
  npx github:arjendev/launchpad-hq --daemon        Start daemon mode
  npx github:arjendev/launchpad-hq --daemon --watch Daemon with auto-restart on changes
  npx github:arjendev/launchpad-hq --help          Show this help

Options:
  --port <port>           HQ server port (1024-65535, default: 3000)
  --self-daemon           Enable built-in daemon when running HQ
  --daemon                Start in daemon mode instead of HQ mode
  --watch                 Auto-restart daemon on file changes (with --daemon)
  --hq-url <url>          Daemon: HQ WebSocket URL
  --token <token>         Daemon: authentication token
  --project-id <id>       Daemon: project identifier (owner/repo)
  --preview-port <port>   Daemon: explicit preview port
  --tunnel                Auto-start Dev Tunnel on boot
  --help, -h              Show this help message

Prerequisites:
  GitHub CLI (gh) must be installed and authenticated: gh auth login`);
  process.exit(0);
}

const isDaemon = args.includes('--daemon');
const isWatch = args.includes('--watch');
const isSelfDaemon = args.includes('--self-daemon');

/**
 * Parse a `--flag <value>` or `--flag=<value>` pair from CLI args.
 * Returns the raw string value, or undefined if the flag is absent.
 */
function getArgValue(flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
    if (args[i].startsWith(`${flag}=`)) return args[i].slice(flag.length + 1);
  }
  return undefined;
}

/**
 * Parse and validate a port number from CLI args.
 * Exits with an error message if the value is not a valid port (1024-65535).
 */
function parsePort(flag: string): number | undefined {
  const raw = getArgValue(flag);
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error(`❌ Invalid ${flag} value "${raw}": must be an integer between 1024 and 65535`);
    process.exit(1);
  }
  return port;
}

const cliPort = parsePort('--port');
const cliPreviewPort = parsePort('--preview-port');

// Pre-flight: ensure GitHub CLI is installed and authenticated
const { ensureGhAuthenticated } = await import('./preflight/gh-check.js');
await ensureGhAuthenticated();

if (isDaemon && isWatch) {
  // Re-exec with Node's built-in --watch mode (Node 18+)
  // This watches all imported files and restarts on change
  const { spawn } = await import('node:child_process');

  console.log('👀 Watch mode: daemon will restart on file changes');

  const filteredArgs = process.argv.slice(1).filter(a => a !== '--watch');
  const child = spawn(
    process.execPath,
    ['--watch', '--watch-preserve-output', ...filteredArgs],
    { stdio: 'inherit' },
  );

  child.on('exit', (code) => process.exit(code ?? 0));

  // Forward signals to child
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} else if (isDaemon) {
  try {
    // Parse daemon-specific CLI flags
    const configOverrides: Record<string, string | number | undefined> = {};

    const hqUrlVal = getArgValue('--hq-url');
    if (hqUrlVal) configOverrides.hqUrl = hqUrlVal;

    const tokenVal = getArgValue('--token');
    if (tokenVal) configOverrides.token = tokenVal;

    const projectIdVal = getArgValue('--project-id');
    if (projectIdVal) configOverrides.projectId = projectIdVal;

    if (cliPreviewPort !== undefined) configOverrides.previewPort = cliPreviewPort;

    // Dynamic import keeps HQ-only dependencies out of daemon memory
    const { startDaemon } = await import('./daemon/index.js');
    const daemon = startDaemon(Object.keys(configOverrides).length > 0 ? configOverrides : undefined);

    process.on('SIGINT', () => {
      daemon.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      daemon.shutdown();
      process.exit(0);
    });

    console.log('🤖 Daemon mode active');
  } catch (err) {
    console.error('💀 Daemon startup failed:', err);
    process.exit(1);
  }
} else {
  // HQ mode — apply CLI flags via process.env before server config loads
  if (cliPort !== undefined) {
    process.env.PORT = String(cliPort);
  }
  if (isSelfDaemon) {
    process.env.LAUNCHPAD_SELF_DAEMON = 'true';
  }

  // HQ mode — check first-launch onboarding before server boot
  const { configExists, runOnboardingWizard } = await import('./server/onboarding/index.js');
  if (!configExists()) {
    await runOnboardingWizard();
  }

  await import('./server/index.js');
}

export {};
