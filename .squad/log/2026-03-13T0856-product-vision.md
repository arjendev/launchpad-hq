# Session: Product Vision — launchpad-hq
**Date:** 2026-03-13T08:56:00Z  
**Lead:** Arjen (via Copilot)  
**Type:** Product vision & architecture alignment

## Summary

Arjen finalized the product vision for launchpad-hq, a personal mission control dashboard for developers. All key architectural and product decisions were made during this session.

## Key Decisions Captured

- **Package Name:** `launchpad-hq` (npm package; "launchpad" was taken)
- **Architecture:** React web app + Fastify server + Microsoft Dev Tunnels (phone access via devtunnel bridge)
- **State Management:** User's own GitHub `launchpad-state` repo (no hosted services)
- **Data Source:** GitHub Issues (source of truth) + local enrichment (devcontainer status, session links)
- **Projects:** GitHub repos + optional devcontainer enrichment
- **Devcontainers:** @devcontainers/cli for discovery and management
- **Copilot Integration:** GitHub Copilot SDK for session introspection and steering
- **Session Control:** Full terminal takeover via xterm.js
- **UI:** Three-pane mission control dashboard (projects, kanban, live sessions)
- **Auth:** `gh auth token` (gh CLI as auth provider)
- **Stack:** React + Vite + TanStack Query/Router + Mantine + Fastify + ws
- **User Model:** Single-user personal tool

## Vision Statement

One developer. One mission control. Maximum clarity and control over all their work.

## Next Steps

- Write formal VISION.md with architectural narrative
- Begin prototype implementation
- Set up dev environment and tooling
