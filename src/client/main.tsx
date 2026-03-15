import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAuthFromUrl } from "./services/auth";

// Extract and store the HQ token from the URL before React mounts.
// This also cleans the token from the URL bar to prevent leaking.
initAuthFromUrl();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
