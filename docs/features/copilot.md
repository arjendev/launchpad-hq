# Copilot Sessions

Launchpad HQ provides deep introspection of GitHub Copilot sessions through the daemon's SDK bridge.

## How It Works

The daemon uses `@github/copilot-sdk` (technical preview) to:

- **Discover** active Copilot sessions in the project
- **Stream** conversation events in real-time
- **Inject** prompts into active sessions
- **Register** custom tools for HQ coordination

HQ never talks to the SDK directly — the daemon acts as the bridge.

## Sessions Panel

The right pane's **Copilot Sessions** section shows:

- Active session count with badge
- Session cards with expandable conversation view (lazy-loaded)
- Real-time updates via WebSocket

## SDK vs CLI Mode

Configure your preference during onboarding or in Settings:

| Mode | Description |
|------|-------------|
| **SDK** | Full `@github/copilot-sdk` integration. Deep session introspection, event streaming, prompt injection. |
| **CLI** | Simpler GitHub Copilot CLI interaction. Limited introspection. |

## Custom Tools

The daemon registers HQ-aware tools with the Copilot SDK:

- `report_progress` — Report task progress back to HQ
- `request_human_review` — Flag items needing human attention
- `report_blocker` — Signal blocking issues

These tools appear in the Attention Items section of the sessions panel.
