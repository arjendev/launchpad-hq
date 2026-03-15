/**
 * Preview hooks — TanStack Query + WebSocket integration for project app previews.
 *
 * APIs consumed:
 * - GET /api/preview — list all daemons with preview enabled
 * - GET /api/preview/:projectId — preview state for one project
 * - GET /api/preview/:projectId/qr — QR code data-URL
 * - POST /api/preview/:projectId/start — start preview
 * - POST /api/preview/:projectId/stop — stop preview
 * - GET /api/tunnel — tunnel state (for building preview URLs)
 * - WebSocket channel "preview" — real-time config updates
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSubscription } from "../contexts/WebSocketContext.js";
import type { PreviewEntry, PreviewState, PreviewQrResponse, TunnelState } from "./types.js";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { message?: string })?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function encodeProjectId(projectId: string): string {
  return encodeURIComponent(projectId);
}

// ── Queries ─────────────────────────────────────────────────────────────────

/** List all daemons with preview enabled (polls every 10s). */
export function usePreviewList() {
  return useQuery<PreviewEntry[]>({
    queryKey: ["preview-list"],
    queryFn: () => fetchJson<PreviewEntry[]>("/api/preview"),
    refetchInterval: 10_000,
  });
}

/** Preview state for a single project. */
export function usePreviewState(projectId: string | null) {
  return useQuery<PreviewState>({
    queryKey: ["preview-state", projectId],
    queryFn: () =>
      fetchJson<PreviewState>(`/api/preview/${encodeProjectId(projectId!)}`),
    enabled: !!projectId,
    refetchInterval: 10_000,
  });
}

/** QR code for a project preview — only fetched when enabled (modal open). */
export function usePreviewQr(projectId: string | null, enabled: boolean) {
  return useQuery<PreviewQrResponse>({
    queryKey: ["preview-qr", projectId],
    queryFn: () =>
      fetchJson<PreviewQrResponse>(`/api/preview/${encodeProjectId(projectId!)}/qr`),
    enabled: !!projectId && enabled,
    staleTime: 30_000,
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** Start a project preview server. */
export function useStartPreview() {
  const qc = useQueryClient();
  return useMutation<PreviewState, Error, string>({
    mutationFn: (projectId) =>
      fetchJson<PreviewState>(`/api/preview/${encodeProjectId(projectId)}/start`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["preview-list"] });
    },
  });
}

/** Stop a project preview server. */
export function useStopPreview() {
  const qc = useQueryClient();
  return useMutation<PreviewState, Error, string>({
    mutationFn: (projectId) =>
      fetchJson<PreviewState>(`/api/preview/${encodeProjectId(projectId)}/stop`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["preview-list"] });
    },
  });
}

// ── WebSocket integration ───────────────────────────────────────────────────

/**
 * Subscribe to the "preview" WebSocket channel and invalidate TanStack Query
 * caches when preview:config events arrive, keeping the UI in sync in real time.
 */
export function usePreviewWebSocket() {
  const qc = useQueryClient();
  const { data: wsUpdate } = useSubscription<{ type: string; projectId?: string }>("preview");
  const prevRef = useRef(wsUpdate);

  useEffect(() => {
    if (wsUpdate && wsUpdate !== prevRef.current) {
      prevRef.current = wsUpdate;
      if (wsUpdate.type === "preview:config") {
        void qc.invalidateQueries({ queryKey: ["preview-list"] });
        if (wsUpdate.projectId) {
          void qc.invalidateQueries({ queryKey: ["preview-state", wsUpdate.projectId] });
          void qc.invalidateQueries({ queryKey: ["preview-qr", wsUpdate.projectId] });
        }
      }
    }
  }, [wsUpdate, qc]);
}

// ── URL helpers ─────────────────────────────────────────────────────────────

/** Build the preview URL for a project given the tunnel state. */
export function buildPreviewUrl(tunnelState: TunnelState | undefined, projectId: string): string | null {
  if (!tunnelState?.shareUrl) return null;
  const base = tunnelState.shareUrl.replace(/\/$/, "");
  return `${base}/preview/${encodeURIComponent(projectId)}/`;
}

/** Build a local (relative) preview URL that works without a tunnel. */
export function buildLocalPreviewUrl(projectId: string): string {
  return `/preview/${encodeURIComponent(projectId)}/`;
}

/** Format detection source for display (e.g. "Vite" from "vite.config.ts"). */
export function formatDetectionSource(detectedFrom?: string): string | null {
  if (!detectedFrom) return null;
  if (detectedFrom.includes("vite")) return "Vite";
  if (detectedFrom.includes("next")) return "Next.js";
  if (detectedFrom.includes("webpack")) return "Webpack";
  if (detectedFrom.includes("angular")) return "Angular";
  return detectedFrom;
}
