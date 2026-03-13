# Squad Team

> launchpad — Command and control center for managing multiple projects across repositories

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Cooper | Lead | .squad/agents/cooper/charter.md | 🏗️ Active |
| Brand | Frontend Dev | .squad/agents/brand/charter.md | ⚛️ Active |
| Romilly | HQ Server Specialist | .squad/agents/romilly/charter.md | 🔧 Active |
| TARS | Daemon & SDK Specialist | .squad/agents/tars/charter.md | ⚙️ Active |
| Doyle | Quality Reviewer | .squad/agents/doyle/charter.md | 🧪 Active |
| Scribe | Session Logger | .squad/agents/scribe/charter.md | 📋 Active |
| Arjen | 👤 Human · Reviewer | — | 👤 Active |

### Restructuring notes (Wave 2 → Wave 3 transition)
- **CASE merged into TARS** — both were building daemon/SDK code in `src/daemon/` and `src/shared/`. TARS now owns all daemon, protocol, and Copilot SDK work.
- **Doyle repurposed** — from standalone tester to post-wave quality reviewer (e2e sweeps, integration tests, Playwright). Agents write their own unit tests.
- **Ralph removed** — work monitor role absorbed by Cooper.
- **Scribe** — stays but will use a standard model (was on haiku, kept hitting rate limits).

## Project Context

- **Owner:** Arjen
- **Project:** launchpad — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Potentially leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, npx CLI, Terminal/Web UI, GitHub API, Copilot SDK, Devcontainer API
- **Created:** 2026-03-13
