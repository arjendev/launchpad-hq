# Decision: Client shell layout approach

**Date:** 2026-03-13
**By:** Brand (Frontend Dev)
**Issue:** #3

## What
Used Mantine `AppShell` for the header/main structure and raw `Flex` + `ScrollArea` for the three-pane layout (instead of Mantine's `Grid`).

## Why
- `AppShell` handles the fixed header with proper offset for `Main` content — no manual height math.
- `Flex` gives direct control over the three-pane proportions (250px / flex / 300px) without fighting grid column semantics.
- `useMediaQuery("(max-width: 768px)")` toggles `Flex` direction between `row` and `column` for responsive stacking — simpler than Mantine's responsive grid props for this use case.
- `ScrollArea` on each pane ensures independent scrolling when content overflows.

## Impact
Future pane additions or resizable panels should follow this `Flex`-based pattern rather than introducing `Grid`.
