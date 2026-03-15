/**
 * HQ authentication token management.
 *
 * The token is passed via URL query parameter when the user first opens HQ.
 * It is stored in-memory only (not localStorage) to avoid exposure to other scripts.
 */

let hqToken: string | null = null;

/** Get the current HQ authentication token. */
export function getHqToken(): string | null {
  return hqToken;
}

/** Set the HQ authentication token. */
export function setHqToken(token: string): void {
  hqToken = token;
}

/**
 * Extract the token from the URL query string, store it, and clean the URL.
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
  }
}
