# Decision: WebSocket Client Architecture

**By:** Brand (Frontend Dev)
**Date:** 2026-03-13
**Issue:** #17

## What
WebSocket client uses a single `WebSocketManager` class instance shared via React context (`WebSocketProvider`). Two hooks exposed: `useWebSocket()` for raw access and `useSubscription(channel)` for typed channel subscriptions. Manager handles auto-reconnect with exponential backoff, message queuing during disconnects, and channel re-subscription on reconnect.

## Why
- Single manager avoids multiple connections to the same server.
- Context provider makes the connection available anywhere in the component tree without prop drilling.
- `useSubscription` returns `{ data, status }` — simple API for any component that needs real-time channel data.
- Message queuing prevents lost messages during brief disconnects (capped at 100 to avoid memory leaks).
- Exponential backoff (1s → 30s max) avoids hammering the server during outages.

## Impact
- All future real-time features (devcontainer status, copilot sessions, terminal) use `useSubscription(channel)`.
- ConnectionStatus badge in the header gives users confidence the dashboard is live.
- The message protocol must stay in sync between `src/client/services/ws-types.ts` and `src/server/ws/types.ts`.
