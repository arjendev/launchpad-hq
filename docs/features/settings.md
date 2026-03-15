# Settings

The Settings page provides centralized configuration for Launchpad HQ.

## Accessing Settings

Click the **gear icon** (⚙️) in the top bar — available on both desktop and mobile layouts.

## Configuration Sections

Settings mirror the onboarding wizard steps:

### State Mode

Choose where project state is stored:

- **GitHub** — `launchpad-state` repository with local cache
- **Local** — Filesystem-only at `~/.launchpad/state/`

### Copilot Preference

- **SDK** — Full `@github/copilot-sdk` integration
- **CLI** — Simpler Copilot CLI mode

### Default Model

Select the default AI model for Copilot sessions.

### DevTunnel

- Toggle tunnel on/off
- View live tunnel status badge
- Configure tunnel mode

## Save Behavior

Changes save **immediately** on interaction — no explicit save button needed. Each setting change fires a `PUT /api/settings` request with optimistic updates.

## Restart-Required Settings

Some settings require a server restart to take effect:

- State mode changes
- Tunnel mode changes

These show a **"restart required"** badge after modification.

## Storage

Settings are persisted to `~/.launchpad/config.json`, separate from server configuration and project state.
