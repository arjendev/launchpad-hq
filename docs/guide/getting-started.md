# Getting Started

Launchpad HQ is a local command and control center for managing multiple projects across repositories. It runs as a local web app served by a Fastify server — no hosted services required.

## Prerequisites

- **Node.js** 20 or later
- **GitHub CLI** (`gh`) installed and authenticated (`gh auth login`)
- A GitHub account with repos you want to manage

## Quick Start

Run directly with npx (all platforms):

```bash
npx launchpad-hq
```

Or install globally:

```bash
npm install -g launchpad-hq
launchpad-hq
```

::: tip Building from source
To install from the GitHub repo instead: `npx github:arjendev/launchpad-hq`. Note that building from source on Windows may fail due to NTFS file locking issues — use WSL or the npm package instead.
:::

### Options

```bash
launchpad-hq --port 4321      # Custom port (default: 4321)
launchpad-hq --host 0.0.0.0   # Bind to all interfaces
launchpad-hq --verbose         # Debug logging
launchpad-hq --self-daemon     # Also start the built-in daemon
launchpad-hq --help            # Show all options
```

On first run, the **onboarding wizard** will walk you through initial setup:

1. **State mode** — Choose where to store your project state (GitHub repo or local filesystem)
2. **Copilot preference** — Configure GitHub Copilot SDK or CLI mode
3. **Default model** — Select your preferred AI model
4. **DevTunnel** — Optionally enable remote access via Microsoft Dev Tunnels

Once onboarding completes, your browser opens to the three-pane dashboard.

## Adding Your First Project

1. Click the **+** button in the project list panel (left pane)
2. Enter the GitHub repository URL (e.g. `owner/repo`)
3. Select the runtime target: **WSL + Devcontainer**, **WSL only**, or **Local folder**
4. The project appears in the list with a health badge

## Build Scripts

The project uses two lifecycle scripts in `package.json`:

- **`postinstall`** — Runs `node scripts/patch-sdk.js` after every `npm install`. This patches an ESM import in `@github/copilot-sdk` that doesn't resolve correctly in Node.js. This is a temporary workaround until the upstream package is fixed.
- **`prepare`** — Runs `npm run build` when you install the package from source (e.g. `npx github:arjendev/launchpad-hq`). In CI environments (where `$CI` is set), the build step is skipped to avoid redundant builds.

If you're developing locally, the build runs automatically after install. You can also run it manually:

```bash
npm run build          # Build both server and client
npm run build:server   # Build server only (TypeScript → dist/)
npm run build:client   # Build client only (Vite)
```

## Next Steps

- [Onboarding Wizard](./onboarding) — Detailed walkthrough of each setup step
- [Architecture](./architecture) — How HQ, daemons, and state management work together
- [Projects](../features/projects) — Managing projects in the dashboard
