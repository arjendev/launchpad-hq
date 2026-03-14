#!/usr/bin/env node

/**
 * CLI entry point for launchpad-hq.
 *
 * Usage:
 *   launchpad-hq               — start HQ server (default)
 *   launchpad-hq --hq          — start HQ server (explicit)
 *   launchpad-hq --daemon      — start daemon mode
 *   launchpad-hq --daemon --watch — start daemon with auto-restart on file changes
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
const isDaemon = args.includes('--daemon');
const isWatch = args.includes('--watch');

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
    // Dynamic import keeps HQ-only dependencies out of daemon memory
    const { startDaemon } = await import('./daemon/index.js');
    const daemon = startDaemon();

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
  // HQ mode — import the existing server entry point
  await import('./server/index.js');
}

export {};
