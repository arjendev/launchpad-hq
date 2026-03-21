import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useMemo } from "react";
import { useSubscription } from "../contexts/WebSocketContext.js";
import { authFetchJson as fetchJson } from "./authFetch.js";
import type { DaemonSummary } from "./types.js";

/** Fetch all connected daemons, polling every 5 seconds. */
export function useDaemons(): {
  daemons: DaemonSummary[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const qc = useQueryClient();
  const query = useQuery<DaemonSummary[]>({
    queryKey: ["daemons"],
    queryFn: () => fetchJson<DaemonSummary[]>("/api/daemons"),
    refetchInterval: 5_000,
  });

  const { data: wsUpdate } = useSubscription<DaemonSummary>("daemon");

  const prevUpdateRef = useRef<DaemonSummary | null>(null);
  useEffect(() => {
    if (wsUpdate && wsUpdate !== prevUpdateRef.current) {
      prevUpdateRef.current = wsUpdate;
      void qc.invalidateQueries({ queryKey: ["daemons"] });
    }
  }, [wsUpdate, qc]);

  return {
    daemons: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/** Find the daemon connected for a specific project. */
export function useDaemonForProject(projectId: string | undefined): {
  daemon: DaemonSummary | null;
  isLoading: boolean;
} {
  const { daemons, isLoading } = useDaemons();
  const daemon = useMemo(
    () => daemons.find((d) => d.projectId === projectId && d.state === "connected") ?? null,
    [daemons, projectId],
  );
  return { daemon, isLoading };
}
