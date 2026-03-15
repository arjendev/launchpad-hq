# Decision: Client-side auth architecture (Phase 1, Issue #61)

**Date:** 2026-03-16
**Author:** Brand (Frontend Dev)
**Status:** Implemented

## Context

Issue #61 requires authentication for all `/api/*` routes. The server will reject unauthenticated requests with 401. The HQ token is delivered via URL query parameter when the user first opens the page.

## Decisions

### 1. In-memory token storage (not localStorage)
- Token stored in a module-scoped variable in `auth.ts`
- localStorage is accessible to any script running on the page — in-memory is safer
- Trade-off: token lost on page refresh (user must use the console URL again)

### 2. URL cleanup at boot
- `initAuthFromUrl()` runs in `main.tsx` before React mounts
- Uses `window.history.replaceState()` to remove `?token=` from the URL bar
- Prevents leaking in screenshots, bookmarks, browser history

### 3. Centralized authFetch wrapper
- All HTTP calls go through `authFetch()` / `authFetchJson()` in `authFetch.ts`
- Injects `Authorization: Bearer <token>` header automatically
- Eliminates duplicate `fetchJson` definitions (was in hooks.ts and preview-hooks.ts)

### 4. 401 handling — overlay, no redirect
- On 401, a persistent overlay tells the user to reconnect via the console URL
- No redirect or reload — prevents infinite loops and preserves any useful state
- Overlay shown once (flag prevents duplicates)

### 5. WebSocket auth via getHqToken()
- WS connection now reads token from `getHqToken()` instead of fetching `/api/settings`
- Eliminates an extra API call on every WS connect/reconnect
- Token is appended as `?token=<hqToken>` in the WS URL (server validates on upgrade)

## Files Changed

- `src/client/services/auth.ts` (new)
- `src/client/services/authFetch.ts` (new)
- `src/client/main.tsx`
- `src/client/services/hooks.ts`
- `src/client/services/preview-hooks.ts`
- `src/client/services/ws.ts`
- `src/client/components/CopilotConversation.tsx`
- `src/client/components/Terminal.tsx`
- `src/client/components/SessionList.tsx`
