import { test, expect } from "@playwright/test";

test.describe("Preview proxy", () => {
  test("proxies to Fastify instead of serving SPA index.html", async ({
    request,
  }) => {
    // Send with Accept: text/html to simulate a browser navigation —
    // this is what triggers Vite's SPA fallback if the proxy fails.
    const response = await request.get("/preview/test-project/", {
      headers: { Accept: "text/html" },
    });

    const body = await response.text();

    // Must NOT be the SPA shell — that would mean the proxy failed
    // and Vite's htmlFallbackMiddleware served index.html instead.
    expect(body).not.toContain('<div id="root"></div>');
    expect(body).not.toContain("main.tsx");

    // Without a connected daemon Fastify returns 503 JSON
    expect(response.status()).toBe(503);
    const json = JSON.parse(body);
    expect(json).toHaveProperty("error", "not_connected");
  });

  test("preserves percent-encoded slashes in project ID", async ({
    request,
  }) => {
    const response = await request.get("/preview/owner%2Frepo/", {
      headers: { Accept: "text/html" },
    });

    const body = await response.text();
    expect(body).not.toContain('<div id="root"></div>');

    // Should reach Fastify, not the SPA
    expect(response.status()).toBe(503);
    const json = JSON.parse(body);
    expect(json).toHaveProperty("error", "not_connected");
  });
});
