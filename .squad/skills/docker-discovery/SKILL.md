# Skill: Docker Container Discovery via CLI

## Pattern

Discover and monitor Docker containers using the Docker CLI with injectable executor for testability.

## Key Elements

1. **DockerExecutor interface** — abstracts `execFile` behind `{ exec(cmd, args): Promise<{stdout, stderr}> }` so tests can inject mock responses without Docker installed.

2. **Label-based filtering** — `docker ps -a --filter label=KEY` to find containers by label, then `docker inspect ID1 ID2 ...` in a single call for all metadata.

3. **Polling + diffing** — Store previous snapshot as `Map<containerId, Container>`. On each poll, diff for: new IDs (absent→present), removed IDs (present→absent), status changes (running↔stopped). Only broadcast on actual changes.

4. **Graceful degradation chain**: Docker not installed → `{ dockerAvailable: false }` | Docker up, no containers → empty list | Inspect fails → error message with partial result.

## Files

- `types.ts` — Container, DiscoveryResult, StatusUpdate, Change types
- `discovery.ts` — `isDockerAvailable()`, `discoverContainers(executor?)` 
- `monitor.ts` — `ContainerMonitor` class with start/stop/poll/diff
- `plugin.ts` — Fastify plugin with REST endpoint + WebSocket broadcast

## Testing

Mock the `DockerExecutor` to return pre-canned JSON for `docker ps` and `docker inspect`. No Docker daemon needed for tests.
