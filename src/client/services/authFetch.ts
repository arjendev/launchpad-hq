/**
 * Authenticated fetch wrapper.
 *
 * Adds `Authorization: Bearer <hqToken>` to every request and handles
 * 401 responses with a user-friendly auth failure message.
 */
import { getHqToken } from "./auth.js";

let authFailureShown = false;

function showAuthFailure(): void {
  if (authFailureShown) return;
  authFailureShown = true;

  // Create a non-intrusive overlay so the user knows what happened
  const overlay = document.createElement("div");
  overlay.id = "auth-failure-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.75)",
    zIndex: "99999",
    fontFamily: "system-ui, -apple-system, sans-serif",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    background: "#1a1b1e",
    color: "#c1c2c5",
    padding: "2rem",
    borderRadius: "8px",
    maxWidth: "420px",
    textAlign: "center",
    border: "1px solid #373a40",
  });
  card.innerHTML = `
    <h2 style="color: #fff; margin: 0 0 0.75rem 0; font-size: 1.25rem;">Session expired</h2>
    <p style="margin: 0; line-height: 1.5;">
      Please use the URL from the console to reconnect.
    </p>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

/**
 * Authenticated fetch — drop-in replacement for `window.fetch` that injects
 * the Bearer token and handles 401 responses.
 */
export async function authFetch(
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const token = getHqToken();
  const headers = new Headers(init?.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { ...init, headers });

  if (response.status === 401) {
    showAuthFailure();
  }

  return response;
}

/**
 * Authenticated JSON fetch — fetches a URL with auth, checks response status,
 * and returns parsed JSON.
 */
export async function authFetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await authFetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
