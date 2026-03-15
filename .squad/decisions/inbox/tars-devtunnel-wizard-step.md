# Decision: DevTunnel Wizard Step — Polling Auth Instead of Spawning Login

**By:** TARS (Daemon & SDK Specialist)
**Date:** 2026-03-15
**Issue:** #44

## Decision

The devtunnel wizard step does NOT spawn `devtunnel user login` as a child process. Instead, it instructs the user to run the command in another terminal and polls `devtunnel user show` every 3 seconds for up to 2 minutes to detect successful authentication.

## Why

1. **@clack/prompts conflict**: The wizard UI controls stdin/stdout via @clack/prompts. Spawning an interactive child process with `stdio: "inherit"` would conflict with the clack rendering.
2. **Devcontainer compatibility**: In codespaces/devcontainers, `devtunnel user login` opens a device code flow that may try to launch a browser (which may not work). Having the user run it in their own terminal gives them full control.
3. **Simplicity**: Polling is straightforward, testable (mock `isAuthenticated()`), and has no child process lifecycle management.

## Trade-offs

- User must open a second terminal — slightly more friction
- 2-minute timeout may not be enough for slow auth flows (but falls back gracefully to on-demand)

## Related

- DevtunnelOps interface enables future changes to auth flow without touching the wizard step
- Consistent with #45's "never crash" principle — all paths are try/catch wrapped
