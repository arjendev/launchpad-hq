# Project Context

- **Owner:** Arjen
- **Project:** launchpad — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Potentially leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, npx CLI, Terminal/Web UI, GitHub API, Copilot SDK, Devcontainer API
- **Created:** 2026-03-13

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-13: GitHub Auth Module Structure
- Auth module lives in `src/server/github/` with three files: `types.ts`, `auth.ts`, `plugin.ts`
- `auth.ts` exports `getGitHubToken()`, `getCachedUser()`, `getCachedAuth()`, `clearAuthCache()`, and `GitHubAuthError`
- Token is obtained via `execFile("gh", ["auth", "token"])` — uses execFile (not exec) for safety
- Token + user validated against GitHub API (GET /user) and cached in-memory for server lifetime
- `plugin.ts` uses `fastify-plugin` (fp) to register as non-encapsulated plugin; decorates server with `githubToken` and `githubUser`
- Error handling uses custom `GitHubAuthError` class with `code` field: `GH_NOT_FOUND`, `NOT_AUTHENTICATED`, `TOKEN_INVALID`
- Server index catches `GitHubAuthError` at startup for clean console error messages (no stack traces for user-facing auth errors)
