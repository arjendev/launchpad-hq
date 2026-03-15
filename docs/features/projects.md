# Projects

Projects are the core unit in Launchpad HQ. Each project maps to a GitHub repository with a specified runtime target.

## Adding a Project

Add projects through the dashboard's left pane:

1. Click the **+** button
2. Enter the repository (e.g. `owner/repo`)
3. Select a runtime target:
   - **WSL + Devcontainer** — Full devcontainer environment
   - **WSL only** — WSL without devcontainer
   - **Local folder** — Direct local filesystem

## Project List Panel

The left pane displays all registered projects with:

- **Health badges** — Color-coded status indicators
- **Daemon status** — Online/offline indicator
- **Work state** — Working, awaiting, or stopped

Projects use TanStack Query with 30–60s polling intervals for status updates.

## Project Lifecycle

Each project has lifecycle states:

| State | Description |
|-------|-------------|
| Initialized | Project registered but daemon not started |
| Online | Daemon connected and reporting |
| Offline | Daemon not connected |
| Working | Active development in progress |
| Awaiting | Waiting for input or review |
| Stopped | Explicitly halted |

## Kanban Board

The center pane shows a kanban board for the selected project:

- **Todo** — Open issues without assignment or progress labels
- **In Progress** — Open issues with assignment or in-progress labels
- **Done** — Closed issues

GitHub Issues are the source of truth. The board is read-only in Phase 1; drag-and-drop will be added later.
