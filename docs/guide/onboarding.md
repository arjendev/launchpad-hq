# Onboarding Wizard

The onboarding wizard runs automatically on first launch, collecting configuration choices before the server starts.

## Overview

The wizard uses `@clack/prompts` for a clean terminal UI. Each step follows a consistent pattern:

- **Prompt** — Present options to the user
- **Validate** — Ensure the selection is valid
- **Apply** — Write the choice to `~/.launchpad/config.json`

Press `Ctrl+C` at any time to cancel. The wizard supports `isCancel()` detection for graceful exit.

## Steps

### 1. State Mode

Choose where Launchpad stores project state:

- **GitHub** — Creates a `launchpad-state` repo. GitHub is the persistence layer with local cache for speed.
- **Local** — Filesystem-only state in `~/.launchpad/state/`. No GitHub repo needed.

### 2. Copilot Preference

Configure how Launchpad interacts with GitHub Copilot:

- **SDK** — Use `@github/copilot-sdk` (technical preview) for deep integration
- **CLI** — Use the GitHub Copilot CLI for simpler interactions

### 3. Default Model

Select the default AI model for Copilot sessions.

### 4. DevTunnel Configuration

Optionally enable Microsoft Dev Tunnels for remote access to your dashboard.

## Non-Interactive Mode

In CI, Docker, or piped input environments (no TTY), the wizard auto-applies defaults and marks onboarding as complete.

## Configuration File

Settings are persisted to `~/.launchpad/config.json` — machine-local, separate from server and project configuration.
