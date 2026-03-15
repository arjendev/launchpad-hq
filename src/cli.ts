#!/usr/bin/env node

/**
 * CLI entry point for launchpad-hq.
 *
 * Usage:
 *   launchpad-hq               — start HQ server (default)
 *   launchpad-hq --hq          — start HQ server (explicit)
 *   launchpad-hq --daemon      — start daemon mode
 *   launchpad-hq --daemon --watch — start daemon with auto-restart on file changes
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
    // Parse daemon-specific CLI flags
    const configOverrides: Record<string, string> = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--hq-url' && args[i + 1]) {
        configOverrides.hqUrl = args[++i];
      } else if (arg.startsWith('--hq-url=')) {
        configOverrides.hqUrl = arg.slice('--hq-url='.length);
      } else if (arg === '--token' && args[i + 1]) {
        configOverrides.token = args[++i];
      } else if (arg.startsWith('--token=')) {
        configOverrides.token = arg.slice('--token='.length);
      } else if (arg === '--project-id' && args[i + 1]) {
        configOverrides.projectId = args[++i];
      } else if (arg.startsWith('--project-id=')) {
        configOverrides.projectId = arg.slice('--project-id='.length);
      }
    }

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
  // HQ mode — check first-launch onboarding before server boot
  const { configExists, runOnboardingWizard } = await import('./server/onboarding/index.js');
  if (!configExists()) {
    await runOnboardingWizard();
  }

  await import('./server/index.js');
}

export {};
