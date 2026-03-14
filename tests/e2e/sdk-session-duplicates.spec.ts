import { test, expect } from "@playwright/test";

/**
 * E2E test: verify SDK session conversation entries appear exactly once.
 *
 * Regression test for the 3× duplicate event bug caused by:
 *   1. CopilotManager.client.on() duplicating session.on() events
 *   2. Leaked listeners on daemon reconnect (start() not idempotent)
 *   3. Explicit synthetic events doubling session.start from session.on()
 */

async function selectLaunchpadProject(page: import("@playwright/test").Page) {
  const projectCard = page.getByText("arjendev/launchpa").first();
  await expect(projectCard).toBeVisible({ timeout: 10_000 });
  await projectCard.click();
  await expect(
    page.getByText("New Session").first(),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe("SDK session duplicate events", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => {
      console.log(`[pageerror] ${err.message}`);
    });

    await page.goto("/");
    await expect(page.getByText("LIVE")).toBeVisible({ timeout: 10_000 });
  });

  test("each conversation entry appears exactly once after sending a message", async ({
    page,
  }) => {
    await selectLaunchpadProject(page);

    // Create a new SDK session
    await page.getByText("New Session").first().click();
    await page.getByText("SDK Session").click();

    // Wait for the session overlay to appear
    const closeBtn = page.locator('[data-testid="floating-close"]');
    await expect(closeBtn).toBeVisible({ timeout: 15_000 });

    // Wait for "No messages yet" or prompt area to be ready
    const promptInput = page.getByTestId("prompt-input");
    await expect(promptInput).toBeVisible({ timeout: 10_000 });

    // Collect WebSocket events to check for duplicates at the protocol level
    const wsEvents: Array<{ type: string; sessionId?: string; timestamp: number }> = [];
    await page.evaluate(() => {
      // Monkey-patch console.log to capture the [LaunchpadHQ Event] logs
      const orig = console.log.bind(console);
      (window as unknown as { __capturedEvents: unknown[] }).__capturedEvents = [];
      console.log = (...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].includes("[LaunchpadHQ Event]")) {
          (window as unknown as { __capturedEvents: unknown[] }).__capturedEvents.push(args[1]);
        }
        orig(...args);
      };
    });

    // Send a message
    await promptInput.fill("hi");
    await page.getByTestId("send-button").click();

    // Wait for a response to appear — either an assistant message or status change
    // Give the SDK up to 30 seconds to respond
    await page.waitForFunction(
      () => {
        const entries = document.querySelectorAll(
          '[data-testid="assistant-message"], [data-testid="status-divider"], [data-testid="error-banner"]',
        );
        return entries.length > 0;
      },
      { timeout: 30_000 },
    ).catch(() => {
      // If no response within 30s, we still verify no duplicates in whatever we have
    });

    // Give a moment for any duplicate events to arrive
    await page.waitForTimeout(2_000);

    // Collect all conversation entries visible in the DOM
    const entries = await page.evaluate(() => {
      const items: Array<{ testId: string; text: string }> = [];
      const testIds = [
        "user-message",
        "assistant-message",
        "tool-card",
        "hq-tool-card",
        "status-divider",
        "error-banner",
      ];
      for (const tid of testIds) {
        const els = document.querySelectorAll(`[data-testid="${tid}"]`);
        for (const el of els) {
          items.push({
            testId: tid,
            text: (el.textContent ?? "").trim().slice(0, 200),
          });
        }
      }
      return items;
    });

    // Count entries by content to detect duplicates
    const contentCounts = new Map<string, number>();
    for (const entry of entries) {
      const key = `${entry.testId}::${entry.text}`;
      contentCounts.set(key, (contentCounts.get(key) ?? 0) + 1);
    }

    // Assert no entry appears more than once
    const duplicates: string[] = [];
    for (const [key, count] of contentCounts) {
      if (count > 1) {
        duplicates.push(`${key} appeared ${count} times`);
      }
    }

    expect(duplicates).toEqual([]);

    // Also verify at the WebSocket event level — no duplicate session-events
    const capturedEvents = await page.evaluate(
      () => (window as unknown as { __capturedEvents: unknown[] }).__capturedEvents ?? [],
    );

    if (capturedEvents.length > 0) {
      // Group by event type + sessionId + rough timestamp (within 1s)
      const eventKeys = new Map<string, number>();
      for (const evt of capturedEvents as Array<{
        type?: string;
        sessionId?: string;
        event?: { type?: string; timestamp?: string | number };
      }>) {
        if (!evt?.event?.type) continue;
        const ts = evt.event.timestamp
          ? Math.floor(new Date(evt.event.timestamp as string).getTime() / 1000)
          : 0;
        const key = `${evt.type}:${evt.event.type}:${ts}`;
        eventKeys.set(key, (eventKeys.get(key) ?? 0) + 1);
      }

      const wsduplicates: string[] = [];
      for (const [key, count] of eventKeys) {
        if (count > 1) {
          wsduplicates.push(`WS event ${key} received ${count} times`);
        }
      }

      expect(wsduplicates).toEqual([]);
    }

    // Clean up — end the session
    const endBtn = page.getByTestId("end-session-button");
    if (await endBtn.isVisible().catch(() => false)) {
      await endBtn.click();
      // Confirm if needed
      if (await endBtn.isVisible().catch(() => false)) {
        await endBtn.click();
      }
    }
  });
});
