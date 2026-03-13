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

### 2026-03-13: State Persistence Module Structure
- State module lives in `src/server/state/` with 6 files: `types.ts`, `github-state-client.ts`, `local-cache.ts`, `state-manager.ts`, `plugin.ts`, `index.ts`
- `GitHubStateClient` wraps GitHub REST Contents API for the user's `launchpad-state` repo (private, auto-created)
- `LocalCache` stores JSON files + SHA companions under `~/.launchpad/cache/` for offline-first reads
- `StateManager` implements `StateService` interface: read-through cache, write-through to GitHub API
- Three state files: `config.json` (ProjectConfig — tracked repos), `preferences.json` (UserPreferences), `enrichment.json` (EnrichmentData — devcontainer status, session links)
- `plugin.ts` uses `fastify-plugin` with `dependencies: ["github-auth"]`; decorates server with `stateService`
- Sync on startup pulls all three files from GitHub into cache; gracefully degrades to defaults if GitHub unreachable
- Write path uses last-write-wins: reads current SHA from cache/remote before PUT
- DI pattern via `StateManagerDeps` for testability — tests inject mock client/cache without vi.mock class issues
- 23 unit tests: 12 for GitHubStateClient (mocked fetch), 11 for StateManager (injected mock deps)

### 2026-03-13: GitHub API Cache Layer
- Cache module lives in `src/server/cache/` with 5 files: `types.ts`, `cache-manager.ts`, `plugin.ts`, `index.ts`, `__tests__/cache-manager.test.ts`
- `CacheManager` is an in-memory TTL cache for GitHub API responses — separate from state's `LocalCache` (which handles state file persistence)
- TTL is configurable per data type: issues/PRs default 60s, repo metadata/viewer repos 300s
- LRU eviction when maxEntries (default 500) exceeded — access order tracked via array
- `buildCacheKey()` creates deterministic keys from data type + sorted params
- `getOrFetch()` implements cache-through pattern: check → miss → fetch → store → return
- Disk persistence: optional JSON snapshot to `~/.launchpad/api-cache/` — saves on shutdown, loads on startup, skips expired entries
- Invalidation: by key, by data type, by key prefix, or full clear
- Stats: hits, misses, evictions, entry count, hit rate (0–1 ratio)
- Fastify plugin registers as `api-cache`, decorates server with `cache`, adds `/api/cache/stats` (GET) and invalidation endpoints (DELETE)
- 25 unit tests: TTL expiry, LRU eviction, cache-through, invalidation, disk round-trip, stats

### 2026-03-13: GitHub GraphQL Client Module
- GraphQL client lives in `src/server/github/` with three new files: `graphql-types.ts`, `graphql.ts`, `graphql-plugin.ts`
- Uses `graphql-request` library (GraphQLClient) — lightweight, typed, supports response middleware for header access
- `GitHubGraphQL` class wraps all queries: `listViewerRepos`, `listIssues`, `listPullRequests`, `fetchRepoMetadata`, `fetchIssuesForRepos`
- `fetchIssuesForRepos` uses GraphQL aliases to batch multiple repo queries into a single request (critical for ~500ms multi-repo fetch)
- Rate-limit tracking via `responseMiddleware` parsing `X-RateLimit-*` headers; exposed as `rateLimit` getter
- Custom `GitHubGraphQLError` with typed `code` field: `RATE_LIMITED`, `UNAUTHORIZED`, `NOT_FOUND`, `GRAPHQL_ERROR`, `NETWORK_ERROR`
- GitHub returns non-standard `type` field on GraphQL errors — requires cast `(error as unknown as { type?: string })` to access
- Fastify plugin uses `fp()` with `dependencies: ["github-auth"]`; decorates server with `githubGraphQL`
- 15 unit tests with fully mocked `graphql-request` (vi.mock + mockRequestFn pattern)

## Phase 1 Summary

**Completed Issues:** #6, #10, #11 (3/8 Phase 1 items)  
**Total Tests Added:** 15 + 23 + 25 = 63 tests  
**Commits:** 3 (GraphQL client, state persistence, cache layer)  

TARS delivered the complete GitHub data pipeline for launchpad:
1. **GraphQL client** — typed queries with alias-based batching for multi-repo efficiency
2. **State persistence** — three-tier architecture (REST client + local cache + manager) for config/preferences/enrichment
3. **API cache** — TTL-based in-memory cache with LRU eviction, disk snapshots, stats monitoring

All three modules are now integrated into the server as Fastify plugins with correct dependency ordering:
- `github-auth` (existing) → `state` (Phase 1) → `api-cache` (Phase 1) → routes

Phase 1 unlocked Romilly's REST API (#7) and Brand's frontend (#8, #9) by providing foundational data access and persistence layers. All issues closed on GitHub.

### 2026-03-13: Devcontainer Discovery & Monitoring Module
- Container module lives in `src/server/containers/` with 5 files: `types.ts`, `discovery.ts`, `monitor.ts`, `plugin.ts`, `index.ts`
- Discovery uses Docker CLI (`docker ps -a --filter label=devcontainer.local_folder` + `docker inspect`) — not `@devcontainers/cli` which would add a heavy dependency
- `discoverContainers()` accepts a `DockerExecutor` interface for testability — production uses `child_process.execFile`, tests inject mocks
- `ContainerMonitor` class: polls on configurable interval (default 10s), diffs against previous snapshot, broadcasts `ContainerStatusUpdate` only when changes detected
- Changes tracked: new container (absent→running/stopped), removed container (running/stopped→absent), status change (running↔stopped)
- Fastify plugin decorates server with `containers.latest()` and `containers.poll()`, registers `GET /api/devcontainers` route
- Plugin depends on `websocket` — registered before route plugins in server index
- Graceful degradation: Docker unavailable returns `{ dockerAvailable: false }`, inspect failures return error message, empty container list is a valid state
- 17 unit tests: Docker availability, container discovery, port parsing, status mapping, monitor diffing, broadcast behavior, edge cases
- **Key pattern**: Parallel agent work creates filesystem entanglement — other agents (attention, copilot) had uncommitted changes. Used `git checkout HEAD --` to restore clean base before applying only my changes.

## Phase 2 Summary

**Completed Issues:** #14 (1/5 Phase 2 items)
**Total Tests Added (Phase 2):** 17 tests
**Commits:** 1 (devcontainer discovery)

TARS delivered devcontainer discovery via Docker CLI — a clean, lightweight alternative to the @devcontainers/cli package. The discovery module integrates with the WebSocket server for real-time status broadcasts. Decision captured in decisions.md.

