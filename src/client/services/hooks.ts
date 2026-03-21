/**
 * Barrel re-export — all domain hooks from a single entry point.
 * Existing consumers import from "../services/hooks.js" and continue to work unchanged.
 *
 * Domain hook files:
 *   dashboard-hooks  — useDashboard, useAddProject, useRemoveProject, discovery, issues
 *   daemon-hooks     — useDaemons, useDaemonForProject
 *   session-hooks    — Copilot session CRUD, SDK controls, agents, plans
 *   conversation-hooks — useConversationEntries, RawSessionEvent
 *   tunnel-hooks     — useTunnelStatus, useTunnelQr, useStartTunnel, useStopTunnel
 *   settings-hooks   — useSettings, useUpdateSettings, useValidateRepo, useResetOnboarding
 */

export * from "./dashboard-hooks.js";
export * from "./daemon-hooks.js";
export * from "./session-hooks.js";
export * from "./conversation-hooks.js";
export * from "./tunnel-hooks.js";
export * from "./settings-hooks.js";
