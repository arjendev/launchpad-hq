# Decision: Server-side URL Token Auth + Security Hardening

**Author:** Romilly (Backend Dev)  
**Date:** 2026-03-15  
**Issue:** #61  
**Status:** Implemented

## Context

Issue #61 identified that launchpad-hq had no request-level authentication — anyone who could reach the server could access all API endpoints and preview proxies.

## Decisions

### 1. Jupyter-style hqToken auth

Reused the existing `sessionToken` (generated via `crypto.randomBytes(32)` in the WS plugin) as the `hqToken` for all HTTP auth. The token is printed in the startup console URL so users can click to open.

**Auth flow:** `Authorization: Bearer <hqToken>` header, with `?token=<hqToken>` query param as fallback.

**Why this approach:** Single token, generated fresh each boot, no persistence needed. Same pattern as Jupyter notebooks. The token never leaves the machine unless the user shares it.

### 2. Health endpoint exempt from auth

`/api/health` is exempt so monitoring tools and load balancers can probe without credentials.

### 3. CORS in all modes

Previously CORS was dev-only. Now registered in all modes with a dynamic origin callback that allows localhost + the active tunnel URL. This prevents browser-based CSRF from arbitrary origins.

### 4. @fastify/helmet for security headers

CSP configured to allow `'unsafe-inline'` for scripts and styles because Vite injects inline scripts and Mantine uses inline styles. This is a pragmatic trade-off — tightening to nonces would require Vite plugin changes.

### 5. Preview port blocklist

Infrastructure ports (SSH, PostgreSQL, Redis, etc.) are blocked from preview proxying. Only ports 1024-65535 minus the blocklist are allowed.

### 6. File permissions 0o700/0o600

State directories get 0o700, files get 0o600. Prevents other users on the same machine from reading config/state files.

## Coordination with other agents

- **Brand:** Simultaneously implementing client-side auth (extracting token from URL, adding Bearer to fetch/WS)
- **TARS:** Simultaneously hardening daemon (command allowlist, input validation)
- No file conflicts — each agent touches only their domain
