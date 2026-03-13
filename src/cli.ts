#!/usr/bin/env node

/**
 * CLI entry point for launchpad-hq.
 *
 * Usage:
 *   launchpad-hq             — start HQ server (default)
 *   launchpad-hq --hq        — start HQ server (explicit)
 *   launchpad-hq --daemon    — start daemon mode
 */

const args = process.argv.slice(2);
const isDaemon = args.includes('--daemon');

if (isDaemon) {
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
} else {
  // HQ mode — import the existing server entry point
  await import('./server/index.js');
}

export {};
