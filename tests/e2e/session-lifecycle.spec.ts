import { test, expect } from "@playwright/test";

/**
 * E2E tests for session lifecycle: create, resume, end.
 * Requires both server (port 3000) and vite dev (port 5173) running
 * with a self-daemon connected.
 */

async function selectLaunchpadProject(page: import("@playwright/test").Page) {
  // Click the launchpad-hq project card in the sidebar
  const projectCard = page.getByText("arjendev/launchpa").first();
  await expect(projectCard).toBeVisible({ timeout: 10_000 });
  await projectCard.click();
  // Wait for the Connected Project panel to show our project
  await expect(
    page.getByText("New Session").first(),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe("Session lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => {
      // Log but don't fail — some errors are pre-existing
      console.log(`[pageerror] ${err.message}`);
    });

    await page.goto("/");
    await expect(page.getByText("LIVE")).toBeVisible({ timeout: 10_000 });
  });

  test("create CLI session, see terminal output, then end it", async ({
    page,
  }) => {
    await selectLaunchpadProject(page);

    // Click "New Session" — it's a menu trigger
    await page.getByText("New Session").first().click();

    // Select "CLI Terminal" from dropdown menu
    await page.getByText("CLI Terminal").click();

    // Wait for session overlay to appear (the floating panel)
    const closeBtn = page.locator('[data-testid="floating-close"]');
    await expect(closeBtn).toBeVisible({ timeout: 15_000 });

    // The header should show "Session —" text
    await expect(page.getByText(/Session —/)).toBeVisible();

    // Should see CLI badge
    await expect(page.getByText("CLI").first()).toBeVisible();

    // Wait for terminal content
    const terminalContainer = page.locator(
      '[data-testid="terminal-container"]',
    );
    await expect(terminalContainer).toBeVisible({ timeout: 5_000 });

    // Wait for terminal data to flow
    await page.waitForTimeout(3000);

    // The end button should be present — requires two clicks (confirmation)
    const endBtn = page.getByTestId("end-session-button");
    await expect(endBtn).toBeVisible();
    await endBtn.click();
    await expect(endBtn).toContainText("Confirm");
    await endBtn.click();

    // Overlay should disappear
    await expect(closeBtn).not.toBeVisible({ timeout: 5_000 });
  });

  test("create SDK session, verify overlay, then end it", async ({ page }) => {
    await selectLaunchpadProject(page);

    await page.getByText("New Session").first().click();
    await page.getByText("SDK Session").click();

    const closeBtn = page.locator('[data-testid="floating-close"]');
    await expect(closeBtn).toBeVisible({ timeout: 15_000 });

    // Should see SDK badge
    await expect(page.getByText("SDK").first()).toBeVisible();

    // Settings cog should be visible for SDK sessions
    const settingsBtn = page.getByTestId("control-panel-toggle");
    await expect(settingsBtn).toBeVisible();

    // Status badge should be present
    await expect(page.getByText(/● idle|● active/).first()).toBeVisible();

    // Prompt input should be visible (CopilotConversation)
    const promptInput = page.getByTestId("prompt-input");
    await expect(promptInput).toBeVisible();

    // End the session (two-click confirmation)
    const endBtn = page.getByTestId("end-session-button");
    await endBtn.click();
    await expect(endBtn).toContainText("Confirm");
    await endBtn.click();
    await expect(closeBtn).not.toBeVisible({ timeout: 5_000 });
  });

  test("resume SDK session from modal, see conversation view", async ({
    page,
  }) => {
    await selectLaunchpadProject(page);

    await page.getByText("Resume").first().click();
    await expect(page.getByText("Resume Session").first()).toBeVisible({ timeout: 5_000 });

    const modalCards = page.locator('.mantine-Modal-body .mantine-Paper-root[style*="cursor"]');
    await expect(modalCards.first()).toBeVisible({ timeout: 3_000 });
    await modalCards.first().click();

    const closeBtn = page.locator('[data-testid="floating-close"]');
    await expect(closeBtn).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Session —/)).toBeVisible();
    await expect(page.getByText(/● idle|● active/).first()).toBeVisible();
    await expect(page.getByTestId("prompt-input")).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("end-session-button").click();
    await page.getByTestId("end-session-button").click();
    await expect(closeBtn).not.toBeVisible({ timeout: 5_000 });
  });

  test("create CLI session, detach, resume CLI from modal, see terminal", async ({
    page,
  }) => {
    await selectLaunchpadProject(page);

    // Create CLI session
    await page.getByText("New Session").first().click();
    await page.getByText("CLI Terminal").click();

    const closeBtn = page.locator('[data-testid="floating-close"]');
    await expect(closeBtn).toBeVisible({ timeout: 15_000 });

    // Wait for terminal data
    await page.waitForTimeout(3000);
    await expect(page.getByText("CLI").first()).toBeVisible();

    // Detach
    await closeBtn.click();
    await expect(closeBtn).not.toBeVisible({ timeout: 3_000 });

    // Open resume modal
    await page.getByText("Resume").first().click();
    await expect(page.getByText("Resume Session").first()).toBeVisible({ timeout: 5_000 });

    // Find and click the CLI session card — may need to scroll
    const modalBody = page.locator(".mantine-Modal-body");
    const cliCard = modalBody.locator('.mantine-Paper-root[style*="cursor"]', {
      has: page.getByText("CLI"),
    });

    // Scroll to find CLI card if needed
    if ((await cliCard.count()) === 0) {
      await modalBody.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await page.waitForTimeout(500);
    }
    await expect(cliCard.first()).toBeVisible({ timeout: 5_000 });
    await cliCard.first().scrollIntoViewIfNeeded();
    await cliCard.first().click();

    // Session overlay should reappear with terminal
    await expect(page.locator('[data-testid="floating-close"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("CLI").first()).toBeVisible();

    // Terminal container should be visible
    await expect(
      page.locator('[data-testid="terminal-container"]'),
    ).toBeVisible({ timeout: 5_000 });

    // Wait for data after resume
    await page.waitForTimeout(2000);

    // Clean up (two-click confirmation)
    await page.getByTestId("end-session-button").click();
    await page.getByTestId("end-session-button").click();
    await page.waitForTimeout(1000);
  });

  test("end button calls delete API and removes session", async ({
    request,
  }) => {
    // Create a session via API
    const createRes = await request.post(
      "/api/daemons/arjendev/launchpad-hq/copilot/sessions",
      { data: { sessionType: "copilot-cli" } },
    );
    expect(createRes.ok()).toBe(true);
    const { sessionId } = await createRes.json();

    // Verify it exists
    const sessionsRes = await request.get(
      "/api/copilot/aggregated/sessions",
    );
    const { sessions } = await sessionsRes.json();
    expect(
      sessions.some(
        (s: { sessionId: string }) => s.sessionId === sessionId,
      ),
    ).toBe(true);

    // Delete via API (like end button does)
    const deleteRes = await request.post(
      `/api/copilot/aggregated/sessions/${sessionId}/delete`,
      { data: {} },
    );
    expect(deleteRes.ok()).toBe(true);

    // Verify it's removed
    const afterRes = await request.get(
      "/api/copilot/aggregated/sessions",
    );
    const { sessions: afterSessions } = await afterRes.json();
    expect(
      afterSessions.some(
        (s: { sessionId: string }) => s.sessionId === sessionId,
      ),
    ).toBe(false);
  });
});
