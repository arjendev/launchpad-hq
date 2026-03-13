# Project Context

- **Owner:** Arjen
- **Project:** launchpad — An npx package serving as a command and control center for managing multiple projects across repositories. Features a UI for project status overview, connected devcontainers with CLI sessions, kanban boards (todo, in progress, done), deep introspection of copilot sessions, and ability to attach to ongoing sessions. Potentially leveraging the GitHub Copilot SDK.
- **Stack:** Node.js, TypeScript, npx CLI, Terminal/Web UI, GitHub API, Copilot SDK, Devcontainer API
- **Created:** 2026-03-13

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-03-13: Client shell setup (Issue #3)
- **Mantine v7** requires `postcss`, `postcss-preset-mantine`, and `postcss-simple-vars` — added `postcss.config.cjs` at project root.
- `MantineProvider` wraps the app with `defaultColorScheme="auto"` for light/dark support.
- **TanStack Router**: `router.tsx` defines a root route with `Outlet` and an index route at `/` rendering `DashboardLayout`.
- **Three-pane layout** uses Mantine `AppShell` for the header + `Flex` for the panes. `ScrollArea` wraps each pane. Left=250px, Right=300px, Center=flex. On small screens (`max-width: 768px` via `useMediaQuery`), panes stack vertically.
- Component structure: `layouts/DashboardLayout.tsx` orchestrates panes; `components/ProjectList.tsx`, `KanbanBoard.tsx`, `SessionsPanel.tsx` are leaf components with placeholder content.
- Vite build root is `src/client` — postcss config must be at the project root for Vite to find it.

### 2026-03-13: Project list panel (Issue #8)
- **TanStack Query** (`@tanstack/react-query`) was already a dependency — added `QueryClientProvider` in `App.tsx` with retry=1 and refetchOnWindowFocus=false defaults.
- **API layer**: `src/client/api/types.ts` mirrors server route response shapes; `src/client/api/hooks.ts` provides `useDashboard()`, `useAddProject()`, `useRemoveProject()`, `useIssues()` hooks.
- **ProjectContext** (`src/client/contexts/ProjectContext.tsx`): shared state for selected project. `ProjectProvider` wraps the app; `useSelectedProject()` exposes `selectedProject` and `selectProject()` to any component.
- **ProjectList** uses `/api/dashboard` (not `/api/projects`) to get issue/PR counts per project in a single call, with 60s auto-refetch.
- **Status indicator**: green=healthy, yellow=needs attention (>10 open issues or >5 open PRs), gray=archived. Simple heuristic, real attention badges come in Phase 4.
- **Add project dialog**: Mantine `Modal` with owner/repo text inputs, calls `POST /api/projects`.
- **Remove project**: inline menu with confirmation step (two-click delete pattern).
- **Button nesting**: Mantine `UnstyledButton` renders a `<button>` — using `component="div"` avoids nested-button HTML violations when ActionIcon is inside.
- **@tabler/icons-react** added as dependency (used by KanbanBoard search input).
- **@testing-library/user-event** added as dev dependency for interaction tests.
- Test utils (`src/test-utils/client.tsx`) now wrap with `QueryClientProvider` + `ProjectProvider` for all client component tests.

### 2026-03-13: Kanban board panel (Issue #9)
- **KanbanBoard** (`src/client/components/KanbanBoard.tsx`) — read-only kanban view of GitHub issues with three columns: Todo, In Progress, Done.
- **Column classification** logic: `classifyIssue()` — `CLOSED` → Done; `OPEN` + (assigned OR has "in-progress" label) → In Progress; remaining `OPEN` → Todo.
- **useIssues hook** (`src/client/api/hooks.ts`) makes two parallel TanStack Query calls (open + closed issues) with 30s auto-refetch. Returns combined list + loading/error states.
- **Issue cards** show: `#number`, title (with lineClamp), labels as colored Mantine `Badge` components, assignee avatars via `Avatar.Group` with tooltips (max 3 shown).
- **Filter bar** at top: `TextInput` with search icon filters by title, issue number, or label name — all client-side via `useMemo`.
- **States**: empty state ("Select a project from the sidebar") when no project, `KanbanSkeleton` with Mantine `Skeleton` components while loading, error state with message.
- **Column headers** include issue count as a circular `Badge`.
- **Responsive**: columns use `Flex wrap="wrap"` with `minWidth: 200px` so they stack on narrow screens.
- **Parallel work pattern**: #8 and #9 ran simultaneously on the same filesystem. #8 committed the shared infrastructure (contexts, api hooks/types, providers) along with my KanbanBoard changes. Future parallel work should use separate git branches to avoid this entanglement.

## Phase 1 Summary

**Completed Issues:** #8, #9 (2/8 Phase 1 items)  
**Total Tests Added:** ~50 tests (shared test infrastructure)  
**Commits:** 2 (project list panel, kanban board panel)  

Brand delivered the complete frontend dashboard for launchpad:
1. **Project list panel** — health status badges, add/remove workflows, shared ProjectContext for pane coordination
2. **Kanban board panel** — three-column layout with auto-classification, search filtering, 30s polling for live updates

Both components are built on top of TanStack Query for data fetching and Mantine for UI. ProjectContext enables cross-pane communication without prop drilling.

The kanban board is read-only in Phase 1 (no drag-and-drop). Classification logic is deterministic and matches GitHub-native workflow (CLOSED → Done; OPEN with assignment/label → In Progress; else Todo). Future phases can add interactive features while keeping the core logic unchanged.

Brand's frontend unlocks the entire user experience by consuming Romilly's REST API and displaying the data hierarchy from TARS' persistence layer.

