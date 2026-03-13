# Project Context

- **Owner:** Arjen
- **Project:** launchpad — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Potentially leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, npx CLI, Terminal/Web UI, GitHub API, Copilot SDK, Devcontainer API
- **Created:** 2026-03-13

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
- **2026-03-13:** Wrote comprehensive VISION.md from decisions.md. The architecture has three distinct data flows: GitHub API (polling via TanStack Query), devcontainer/Docker (WebSocket push via Dev Container CLI), and Copilot SDK (WebSocket push). All converge in the UI but have fundamentally different refresh patterns — polling vs push. The launchpad-state repo is the only persistence layer; there is no local database by design. The single-package monorepo (src/client + src/server) is a deliberate choice to keep `npx` distribution simple — no workspace hoisting or linked packages to worry about.
- **2026-03-13:** Rewrote VISION.md grounded in Arjen's original framing. His "command and control center" phrase is now the product identity, and his "high-level overview to deep-level introspection" concept drives the document structure as a progressive depth model (all projects → single project → kanban → devcontainer → copilot session → takeover). The narrative uses his voice and intent rather than spec-style language, while all confirmed technical decisions from decisions.md are embedded as specifics within that narrative.
