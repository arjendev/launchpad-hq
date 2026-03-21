import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetchJson as fetchJson } from "./authFetch.js";
import type { LaunchpadConfig, OtelConfig } from "./types.js";

/** Fetch current launchpad settings. */
export function useSettings() {
  return useQuery<LaunchpadConfig>({
    queryKey: ["settings"],
    queryFn: () => fetchJson<LaunchpadConfig>("/api/settings"),
    staleTime: 30_000,
  });
}

/** Update launchpad settings (partial merge). */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation<LaunchpadConfig, Error, Partial<LaunchpadConfig>>({
    mutationFn: (body) =>
      fetchJson<LaunchpadConfig>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

/** Validate a GitHub repo for git state storage. Accepts "owner/repo" string. */
export function useValidateRepo() {
  return useMutation<{ valid: boolean; error?: string; message?: string }, Error, string>({
    mutationFn: (ownerRepo) => {
      const [owner, repo] = ownerRepo.split("/", 2);
      return fetchJson<{ valid: boolean; error?: string; message?: string }>("/api/settings/validate-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo }),
      });
    },
  });
}

// ── Onboarding ──────────────────────────────────────────────────────────────

/** Reset onboarding so the setup wizard can be re-run. */
export function useResetOnboarding() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; onboardingComplete: boolean }, Error, void>({
    mutationFn: () =>
      fetchJson<{ ok: boolean; onboardingComplete: boolean }>("/api/onboarding/reset", {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

// ── OTEL ────────────────────────────────────────────────────────────────────

/** Fetch current OTEL configuration. */
export function useOtelSettings() {
  return useQuery<OtelConfig>({
    queryKey: ["otel-settings"],
    queryFn: () => fetchJson<OtelConfig>("/api/settings/otel"),
    staleTime: 30_000,
  });
}

/** Update OTEL configuration (partial merge). */
export function useUpdateOtelSettings() {
  const qc = useQueryClient();
  return useMutation<OtelConfig & { message: string }, Error, Partial<OtelConfig>>({
    mutationFn: (body) =>
      fetchJson<OtelConfig & { message: string }>("/api/settings/otel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["otel-settings"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
