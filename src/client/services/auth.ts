/**
 * HQ authentication token management.
 *
 * The token is passed via URL query parameter when the user first opens HQ.
 * It is persisted to sessionStorage so the session survives page refreshes
 * but is automatically cleared when the browser tab closes.
 */

const SESSION_STORAGE_KEY = "hq-auth-token";

let hqToken: string | null = null;

/** Get the current HQ authentication token. Falls back to sessionStorage if memory is empty. */
export function getHqToken(): string | null {
  if (hqToken) return hqToken;

  if (typeof window !== "undefined") {
    const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      hqToken = stored;
      return stored;
    }
  }

  return null;
}

/** Set the HQ authentication token. Also persists to sessionStorage. */
export function setHqToken(token: string): void {
  hqToken = token;
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  }
}

/** Clear the HQ authentication token from memory and sessionStorage. */
export function clearHqToken(): void {
  hqToken = null;
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

/**
 * Extract the token from the URL query string, store it, and clean the URL.
 * Falls back to sessionStorage if no URL token is present.
 * Should be called once at app startup, before React mounts.
 */
export function initAuthFromUrl(): void {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (token) {
    setHqToken(token);

    // Remove token from URL bar to prevent leaking in screenshots/bookmarks
    params.delete("token");
    const cleanSearch = params.toString();
    const cleanUrl =
      window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
    window.history.replaceState(window.history.state, "", cleanUrl);
    return;
  }

  // No URL token — try to restore from sessionStorage (page refresh scenario)
  getHqToken();
}
