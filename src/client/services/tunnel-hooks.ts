import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetchJson as fetchJson } from "./authFetch.js";
import type { TunnelState, TunnelQrResponse } from "./types.js";

/** Poll tunnel status every 5 seconds. */
export function useTunnelStatus() {
  return useQuery<TunnelState>({
    queryKey: ["tunnel"],
    queryFn: () => fetchJson<TunnelState>("/api/tunnel"),
    refetchInterval: (query) => {
      const data = query.state.data;
      // Only poll frequently when tunnel is running or transitioning
      if (data?.status === "running" || data?.status === "starting" || data?.status === "stopping") {
        return 5_000;
      }
      // When stopped/unconfigured, poll much less frequently
      return 60_000;
    },
  });
}

/** Fetch QR code when tunnel is running. */
export function useTunnelQr(enabled: boolean) {
  return useQuery<TunnelQrResponse>({
    queryKey: ["tunnel-qr"],
    queryFn: () => fetchJson<TunnelQrResponse>("/api/tunnel/qr"),
    enabled,
    staleTime: 30_000,
  });
}

/** Start the dev tunnel. */
export function useStartTunnel() {
  const qc = useQueryClient();
  return useMutation<TunnelState, Error>({
    mutationFn: () =>
      fetchJson<TunnelState>("/api/tunnel/start", { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tunnel"] });
      void qc.invalidateQueries({ queryKey: ["tunnel-qr"] });
    },
  });
}

/** Stop the dev tunnel. */
export function useStopTunnel() {
  const qc = useQueryClient();
  return useMutation<TunnelState, Error>({
    mutationFn: () =>
      fetchJson<TunnelState>("/api/tunnel/stop", { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tunnel"] });
      void qc.invalidateQueries({ queryKey: ["tunnel-qr"] });
    },
  });
}
