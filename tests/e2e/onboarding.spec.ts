import { test, expect } from "@playwright/test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = join(homedir(), ".launchpad", "config.json");

/**
 * Helper: read the persisted config from disk.
 */
async function readConfig() {
  const raw = await readFile(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

/**
 * Helper: reset config to a clean local-mode default so each test starts fresh.
 */
async function resetToDefaults(baseURL: string) {
  await fetch(`${baseURL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stateMode: "local",
      stateRepo: "",
      copilot: { defaultSessionType: "sdk", defaultModel: "claude-opus-4.6" },
      tunnel: { mode: "on-demand", configured: false },
      onboardingComplete: false,
    }),
  });
}

// ---------------------------------------------------------------------------
// 1. Web Onboarding Wizard
// ---------------------------------------------------------------------------
test.describe("Onboarding Wizard", () => {
  test.beforeEach(async ({ page }) => {
    await resetToDefaults("http://localhost:5173");
  });

  test("stepper renders with 4 steps", async ({ page }) => {
    await page.goto("/onboarding");

    // The Mantine Stepper renders step buttons with labels
    await expect(page.getByRole("button", { name: "Storage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copilot" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Model" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tunnel" })).toBeVisible();

    // Step 0 content should be visible on load
    await expect(page.getByText("State Storage Mode")).toBeVisible();
  });

  test("step 1: local mode allows proceeding with Next", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByText("State Storage Mode")).toBeVisible();

    // "Local" should be selected by default
    const nextBtn = page.getByRole("button", { name: /Next/ });
    await expect(nextBtn).toBeEnabled();

    // Click Next — should advance to Copilot step
    await nextBtn.click();
    await expect(page.getByText("Copilot Session Preference")).toBeVisible();
  });

  test("step 1: selecting git shows owner/repo fields", async ({ page }) => {
    await page.goto("/onboarding");

    // Switch to Git
    await page.getByText("☁️ Git").click();

    // Owner and repo fields should appear
    await expect(page.getByLabel("GitHub Owner / Org")).toBeVisible();
    await expect(page.getByLabel("Repository Name")).toBeVisible();

    // Next button should be disabled (no validated repo yet)
    const nextBtn = page.getByRole("button", { name: /Next/ });
    await expect(nextBtn).toBeDisabled();
  });

  test("step 1: git mode — empty repo fails validation", async ({ page }) => {
    await page.goto("/onboarding");

    // Switch to Git
    await page.getByText("☁️ Git").click();

    // Clear the fields explicitly to ensure empty state
    await page.getByLabel("GitHub Owner / Org").clear();
    await page.getByLabel("Repository Name").clear();

    // Validate button should be disabled with empty fields
    const validateBtn = page.getByRole("button", { name: "Validate Repository" });
    await expect(validateBtn).toBeDisabled();
  });

  test("step 1: git mode — valid repo can be validated and proceed", async ({ page }) => {
    await page.goto("/onboarding");
    await page.getByText("☁️ Git").click();

    // Fill in a known-accessible repo
    await page.getByLabel("GitHub Owner / Org").fill("arjendev");
    await page.getByLabel("Repository Name").fill("launchpad-hq");

    // Validate
    const validateBtn = page.getByRole("button", { name: "Validate Repository" });
    await expect(validateBtn).toBeEnabled();
    await validateBtn.click();

    // Wait for success message
    await expect(
      page.getByText(/validated.*write access/i),
    ).toBeVisible({ timeout: 15_000 });

    // Next should now be enabled
    const nextBtn = page.getByRole("button", { name: /Next/ });
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    // Should be on Copilot step
    await expect(page.getByText("Copilot Session Preference")).toBeVisible();
  });

  test("step 1: back button works after advancing", async ({ page }) => {
    await page.goto("/onboarding");

    // Advance to step 2
    await page.getByRole("button", { name: /Next/ }).click();
    await expect(page.getByText("Copilot Session Preference")).toBeVisible();

    // Go back
    await page.getByRole("button", { name: /Back/ }).click();
    await expect(page.getByText("State Storage Mode")).toBeVisible();
  });

  test("step 2: copilot options with correct descriptions", async ({ page }) => {
    await page.goto("/onboarding");
    // Advance to Copilot step
    await page.getByRole("button", { name: /Next/ }).click();

    await expect(page.getByText("🧠 SDK Mode")).toBeVisible();
    await expect(page.getByText("💻 CLI Mode")).toBeVisible();

    // SDK is the default; verify the HQ integration description
    await expect(
      page.getByText(/integration with HQ/i),
    ).toBeVisible();

    // Switch to CLI and check standalone description
    await page.getByText("💻 CLI Mode").click();
    await expect(
      page.getByText(/standalone terminal/i),
    ).toBeVisible();

    // Switch back to SDK for later steps
    await page.getByText("🧠 SDK Mode").click();

    // Proceed
    await page.getByRole("button", { name: /Next/ }).click();
    await expect(page.getByText("Default AI Model")).toBeVisible();
  });

  test("step 3: model picker shows available options", async ({ page }) => {
    await page.goto("/onboarding");
    // Navigate to Model step
    await page.getByRole("button", { name: /Next/ }).click();
    await page.getByRole("button", { name: /Next/ }).click();

    await expect(page.getByText("Default AI Model")).toBeVisible();

    // Open the Select dropdown by clicking the input
    const select = page.getByRole("textbox");
    await select.click();

    // The dropdown should show options — look for a known model in the list
    // Mantine Select renders options as div[role="option"] inside a combobox listbox
    const opuOption = page.getByRole("option", { name: /Claude Opus 4\.6/i }).first();
    // If the server provides models from /api/copilot/models, labels may differ
    // from the hardcoded fallback — just verify at least one option is visible
    const anyOption = page.locator('[role="option"]').first();
    await expect(anyOption).toBeVisible({ timeout: 5_000 });

    // Select the first available option
    await anyOption.click();

    // Proceed
    await page.getByRole("button", { name: /Next/ }).click();
    await expect(page.getByText("Dev Tunnel Configuration")).toBeVisible();
  });

  test("step 4: tunnel mode options exist", async ({ page }) => {
    await page.goto("/onboarding");
    // Navigate to Tunnel step
    await page.getByRole("button", { name: /Next/ }).click();
    await page.getByRole("button", { name: /Next/ }).click();
    await page.getByRole("button", { name: /Next/ }).click();

    await expect(page.getByText("Dev Tunnel Configuration")).toBeVisible();
    await expect(page.getByText("On-demand")).toBeVisible();
    await expect(page.getByText("Always")).toBeVisible();
  });

  test("full wizard completion — local mode", async ({ page }) => {
    await page.goto("/onboarding");

    // Step 0: Storage — local mode (default)
    await page.getByRole("button", { name: /Next/ }).click();

    // Step 1: Copilot — select SDK (default)
    await expect(page.getByText("Copilot Session Preference")).toBeVisible();
    await page.getByRole("button", { name: /Next/ }).click();

    // Step 2: Model — keep default (claude-opus-4.6)
    await expect(page.getByText("Default AI Model")).toBeVisible();
    await page.getByRole("button", { name: /Next/ }).click();

    // Step 3: Tunnel — select on-demand (default)
    await expect(page.getByText("Dev Tunnel Configuration")).toBeVisible();
    await page.getByRole("button", { name: /Next/ }).click();

    // Completion step
    await expect(page.getByText("All set!")).toBeVisible();
    await page.getByRole("button", { name: /Finish Setup/ }).click();

    // Should redirect to dashboard
    await page.waitForURL("/", { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// 2. API-level config persistence tests
// ---------------------------------------------------------------------------
test.describe("Config persistence via API", () => {
  const BASE = "http://localhost:5173";

  test.beforeEach(async () => {
    await resetToDefaults(BASE);
  });

  test("completing onboarding persists correct config", async ({ request }) => {
    // Simulate completing onboarding via the settings PUT endpoint
    const patch = {
      stateMode: "local",
      copilot: { defaultSessionType: "cli", defaultModel: "claude-sonnet-4.6" },
      tunnel: { mode: "on-demand", configured: false },
      onboardingComplete: true,
    };

    const res = await request.put(`${BASE}/api/settings`, { data: patch });
    expect(res.ok()).toBeTruthy();

    // Read config from disk
    const config = await readConfig();
    expect(config.stateMode).toBe("local");
    expect(config.copilot.defaultSessionType).toBe("cli");
    expect(config.copilot.defaultModel).toBe("claude-sonnet-4.6");
    expect(config.tunnel.mode).toBe("on-demand");
    expect(config.onboardingComplete).toBe(true);
  });

  test("git mode persists stateRepo", async ({ request }) => {
    const patch = {
      stateMode: "git",
      stateRepo: "arjendev/launchpad-hq",
      copilot: { defaultSessionType: "sdk", defaultModel: "claude-opus-4.6" },
      tunnel: { mode: "on-demand", configured: false },
      onboardingComplete: true,
    };

    const res = await request.put(`${BASE}/api/settings`, { data: patch });
    expect(res.ok()).toBeTruthy();

    const config = await readConfig();
    expect(config.stateMode).toBe("git");
    expect(config.stateRepo).toBe("arjendev/launchpad-hq");
    expect(config.onboardingComplete).toBe(true);
  });

  test("GET /api/settings reflects persisted config", async ({ request }) => {
    // Write config via PUT
    const patch = {
      copilot: { defaultSessionType: "cli", defaultModel: "gpt-5.2" },
      onboardingComplete: true,
    };
    await request.put(`${BASE}/api/settings`, { data: patch });

    // Read back via GET
    const res = await request.get(`${BASE}/api/settings`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.copilot.defaultSessionType).toBe("cli");
    expect(body.copilot.defaultModel).toBe("gpt-5.2");
    expect(body.onboardingComplete).toBe(true);
  });

  test("invalid stateMode rejected with 400", async ({ request }) => {
    const res = await request.put(`${BASE}/api/settings`, {
      data: { stateMode: "invalid" },
    });
    expect(res.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 3. Settings page tests
// ---------------------------------------------------------------------------
test.describe("Settings page", () => {
  test.beforeEach(async () => {
    // Ensure a known starting config
    await fetch("http://localhost:5173/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stateMode: "local",
        copilot: { defaultSessionType: "sdk", defaultModel: "claude-opus-4.6" },
        tunnel: { mode: "on-demand", configured: false },
        onboardingComplete: true,
      }),
    });
  });

  test("loads with current config values", async ({ page }) => {
    await page.goto("/settings");

    // Title
    await expect(page.getByText("⚙️ Settings")).toBeVisible();

    // Section headings
    await expect(page.getByText("State Storage Mode")).toBeVisible();
    await expect(page.getByText("Copilot Session Preference")).toBeVisible();
    await expect(page.getByText("Default AI Model")).toBeVisible();
    await expect(page.getByText("Dev Tunnel Configuration")).toBeVisible();
  });

  test("changing copilot preference persists via API", async ({ page, request }) => {
    await page.goto("/settings");

    // Switch to CLI
    await page.getByText("💻 CLI Mode").click();

    // Wait for the save confirmation
    await expect(page.getByText("Settings updated successfully")).toBeVisible({ timeout: 5_000 });

    // Verify via GET API
    const res = await request.get("http://localhost:5173/api/settings");
    const body = await res.json();
    expect(body.copilot.defaultSessionType).toBe("cli");
  });

  test("back to dashboard button navigates home", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /Back to Dashboard/ }).click();
    await page.waitForURL("/", { timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Re-onboarding flow
// ---------------------------------------------------------------------------
test.describe("Re-onboarding flow", () => {
  const BASE = "http://localhost:5173";

  test("reset onboarding and verify wizard is accessible", async ({ page, request }) => {
    // First, mark onboarding as complete
    await request.put(`${BASE}/api/settings`, {
      data: { onboardingComplete: true },
    });

    // Verify it's marked complete
    let status = await request.get(`${BASE}/api/onboarding/status`);
    let body = await status.json();
    expect(body.onboardingComplete).toBe(true);

    // Reset
    const resetRes = await request.post(`${BASE}/api/onboarding/reset`);
    expect(resetRes.ok()).toBeTruthy();
    const resetBody = await resetRes.json();
    expect(resetBody.ok).toBe(true);
    expect(resetBody.onboardingComplete).toBe(false);

    // Verify status changed
    status = await request.get(`${BASE}/api/onboarding/status`);
    body = await status.json();
    expect(body.onboardingComplete).toBe(false);

    // Navigate to wizard — it should render
    await page.goto("/onboarding");
    await expect(page.getByText("Setup Wizard")).toBeVisible();
    await expect(page.getByText("State Storage Mode")).toBeVisible();
  });
});
