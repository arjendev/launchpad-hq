# Decision: Wizard step UI pattern and config defaults

**By:** Brand (Frontend Dev)
**Date:** 2026-03-14
**PR:** #49

## Context
Implementing the first three real onboarding wizard steps (#41-#43) required decisions about prompt style and default values.

## Decisions

### 1. Step prompt pattern: note() + select()
Each step uses `p.note()` to explain the choice with clear descriptions/tradeoffs, followed by `p.select()` for the actual selection. This separates education from action — the user reads context first, then picks.

### 2. Default config values updated
- `copilot.defaultSessionType`: `"cli"` → `"sdk"` (richer experience, per #42 spec)
- `copilot.defaultModel`: `"claude-sonnet-4"` → `"claude-opus-4.6"` (per #43 spec)

These affect `defaultLaunchpadConfig()` in `src/server/state/types.ts` — any code relying on the old defaults should be aware.

### 3. AVAILABLE_MODELS as a curated const array
Model list lives as a single exported `AVAILABLE_MODELS` array in `steps.ts`. Currently hardcoded (6 models). Future: can be replaced with SDK runtime discovery per #43 spec.

## Impact
- Config shape unchanged (no breaking changes)
- Default values changed (may affect tests relying on old defaults)
- Devtunnel step (#44) remains a placeholder
