# Decision: Playwright E2E Testing Setup

**By:** Brand (Frontend Dev)
**Date:** 2026-03-13
**Status:** Active

## What

Playwright is now set up as the browser-level E2E testing tool. Configuration:
- Only Chromium (fast, sufficient for dashboard)
- `webServer` config starts both backend and frontend automatically
- `reuseExistingServer: true` so devs can use running servers
- Screenshots on failure, traces on failure
- 30s timeout per test
- Tests live in `tests/e2e/`
- Run via `npm run test:e2e`

## Why

Unit tests (vitest + jsdom) missed a real runtime error: the copilot sessions hook was consuming a wrapped API response as a raw array, causing `TypeError: sessions.map is not a function` in real browsers. Playwright catches these by running actual Chromium.

## Impact

- All frontend PRs should run `npm run test:e2e` to validate browser behavior
- New frontend features should include Playwright smoke tests
- Chromium binary is cached in `~/.cache/ms-playwright/` (~110MB)
