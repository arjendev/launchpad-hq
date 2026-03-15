# App Preview

Launchpad HQ can display a live preview of your project's running application directly within the dashboard.

## Overview

When a project daemon is running and the project has a dev server active, the preview pane renders the application output inline. This provides a quick way to see changes without switching windows.

## Configuration

Preview settings are configured per-project:

- **Port** — The local port your dev server runs on
- **Path** — Optional URL path to load in the preview

## Requirements

- Project daemon must be online
- A dev server must be running in the project
- The dev server port must be accessible from the HQ host

::: info
App Preview is an early feature. Additional configuration options and preview modes will be added in future releases.
:::
