# Decision: Fix Full Stack launch profile — wire Vite preLaunchTask

**Author:** Brand (Frontend Dev)
**Date:** 2025-01-XX
**Status:** Done

## Problem
The "Full Stack" compound launch profile started the Fastify server but never launched the Vite dev server. The "Client (Debug)" config opened Chrome at `localhost:5173`, but nothing was serving there because the `dev:client` task wasn't wired in.

## Fix
Added `"preLaunchTask": "dev:client"` to the "Client (Debug)" configuration in `.vscode/launch.json`.

This means:
- **Full Stack** → launches Server (Debug) + Client (Debug). Client now starts Vite first via the background task, waits for "Local:" output (the problemMatcher endPattern), then opens Chrome.
- **Client (Debug) standalone** → also works: starts Vite, then opens Chrome.
- **Server (Debug) standalone** → unchanged, launches tsx directly.

## Why no tasks.json changes
The `dev:client` task already runs `npx vite --port 5173` from `${workspaceFolder}`. The `vite.config.ts` at workspace root sets `root: "src/client"` and `host: true`, so Vite resolves the correct source directory and binds to all interfaces. No task changes needed.
