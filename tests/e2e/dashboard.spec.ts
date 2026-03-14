import { test, expect } from "@playwright/test";

test.describe("Dashboard smoke tests", () => {
  test("page loads without JavaScript console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    // Wait for the page to settle
    await page.waitForTimeout(3000);

    expect(errors).toEqual([]);
  });

  test("progressive-depth layout renders", async ({ page }) => {
    await page.goto("/");

    // Project list column
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    // Session list column
    await expect(page.getByText("Sessions")).toBeVisible();

    // Main area — empty state when no project selected
    await expect(
      page.getByText("Select a project to get started"),
    ).toBeVisible();
  });

  test("no uncaught exceptions in first 5 seconds after load", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForTimeout(5000);

    expect(errors).toEqual([]);
  });

  test("API proxy works - fetch /api/projects returns 200", async ({
    page,
  }) => {
    await page.goto("/");

    const response = await page.request.get("/api/projects");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty("projects");
    expect(body).toHaveProperty("count");
  });

  test("WebSocket connects - connection status shows Live", async ({
    page,
  }) => {
    await page.goto("/");

    // The ConnectionStatus badge should show "Live" once WebSocket connects
    await expect(page.getByText("Live")).toBeVisible({ timeout: 10_000 });
  });
});
