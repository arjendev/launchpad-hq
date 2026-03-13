# Adapter Pattern for Unstable/Missing Dependencies

## When to Use
When integrating with an external SDK or API that is:
- Not yet available (like the Copilot SDK)
- Unstable or frequently changing
- Needs a mock/simulation mode for development

## Pattern

```
types.ts        → Stable interfaces (your API surface)
adapter.ts      → Interface contract for the backend
mock-adapter.ts → Development/demo implementation
real-adapter.ts → Real SDK implementation (when available)
manager.ts      → Orchestrator (delegates to adapter, adds lifecycle)
plugin.ts       → Framework integration (routes, WebSocket, etc.)
```

## Key Principles

1. **Define your types first** — these are YOUR API, not the SDK's. Map SDK types in the adapter.
2. **Adapter interface is minimal** — list, get, watch, dispose. Don't leak SDK concepts.
3. **Mock must be rich** — the frontend team builds against it. Include realistic data, state transitions, and timing.
4. **Manager owns lifecycle** — start/stop watching, cleanup on shutdown. Adapter is stateless-ish.
5. **Plugin wires everything** — framework registration, route handlers, WebSocket broadcasting.

## Example (from Copilot introspection)

```typescript
// types.ts — YOUR stable interface
interface CopilotAdapter {
  listSessions(): Promise<CopilotSessionSummary[]>;
  getSession(id: string): Promise<CopilotSession | null>;
  startWatching(onChange: (event: SessionChangeEvent) => void): () => void;
  dispose(): void;
}

// plugin.ts — swap adapters based on config
const adapter = useMock
  ? new MockCopilotAdapter(opts)
  : new SdkCopilotAdapter(opts);  // future
```

## Launchpad-Specific Notes
- Used in `src/server/copilot/` for Copilot session introspection
- Fastify plugin pattern with `fastify-plugin` + module augmentation
- WebSocket broadcast via `fastify.ws.broadcast("copilot", event)`
