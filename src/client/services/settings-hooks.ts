import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetchJson as fetchJson } from "./authFetch.js";
import type { LaunchpadConfig } from "./types.js";

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
