import { test, expect } from "@playwright/test";

type DashboardProject = {
  owner: string;
  repo: string;
  daemonStatus?: string;
};

type AgentCatalogEntry = {
  id?: string;
  displayName?: string;
  name?: string;
};

async function selectOnlineProject(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
): Promise<DashboardProject> {
  const dashboardRes = await request.get("/api/dashboard");
  expect(dashboardRes.ok()).toBe(true);

  const dashboard = (await dashboardRes.json()) as { projects: DashboardProject[] };
  const project =
    dashboard.projects.find((entry) => entry.daemonStatus === "online") ??
    dashboard.projects[0];

  if (!project) {
    throw new Error("No tracked projects available for Playwright validation");
  }

  const projectCard = page.getByText(`${project.owner}/${project.repo}`).first();
  await expect(projectCard).toBeVisible({ timeout: 10_000 });
  await projectCard.click();
  await expect(page.getByRole("button", { name: /new/i }).first()).toBeVisible({
    timeout: 10_000,
  });

  return project;
}

test.describe("SDK agent switching", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => {
      console.log(`[pageerror] ${err.message}`);
    });

    await page.goto("/");
    await expect(page.getByText("LIVE")).toBeVisible({ timeout: 10_000 });
  });

  test("reopened SDK sessions can switch agents without 409 responses", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    const project = await selectOnlineProject(page, request);
    const agentsRes = await request.get(
      `/api/daemons/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/copilot/agents`,
    );
    expect(agentsRes.ok()).toBe(true);

    const agentCatalog = (await agentsRes.json()) as { agents: AgentCatalogEntry[] };
    const customAgent = agentCatalog.agents.find(
      (entry) => typeof entry.id === "string" && entry.id !== "builtin:default",
    );
    test.skip(!customAgent, "No custom agent available for agent-switch validation");
    if (!customAgent) {
      return;
    }

    let sessionId: string | null = null;
    const agentResponses: Array<{ method: string; status: number; url: string }> = [];
    const agentPathSuffix = "/agent";

    page.on("response", (response) => {
      const url = response.url();
      if (!url.includes("/api/copilot/aggregated/sessions/") || !url.endsWith(agentPathSuffix)) {
        return;
      }

      agentResponses.push({
        method: response.request().method(),
        status: response.status(),
        url,
      });
    });

    try {
      const createResponsePromise = page.waitForResponse((response) => {
        return (
          response.request().method() === "POST" &&
          response.url().includes(
            `/api/daemons/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/copilot/sessions`,
          ) &&
          response.status() === 200
        );
      });

      await page.getByRole("button", { name: /new/i }).first().click();
      await page.getByRole("menuitem", { name: "Copilot SDK" }).click();

      const createResponse = await createResponsePromise;
      const createBody = (await createResponse.json()) as { sessionId: string };
      sessionId = createBody.sessionId;
      expect(sessionId).toBeTruthy();

      const panel = page.getByTestId("resizable-terminal-panel");
      const promptInput = page.getByTestId("prompt-input");
      const agentSelect = page.getByTestId("session-agent-select");

      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(promptInput).toBeVisible({ timeout: 10_000 });
      await expect(agentSelect).toBeVisible({ timeout: 10_000 });

      const sessionItems = page
        .locator('div[style*="cursor: pointer"]')
        .filter({ hasText: /SDK/ })
        .filter({ hasText: /just now|\ds ago|\dm ago|\dh ago|\dd ago/ });
      const createdSessionItem = sessionItems.last();

      await expect(createdSessionItem).toBeVisible({ timeout: 10_000 });

      await page.getByTestId("panel-detach").click();
      await expect(panel).not.toBeVisible({ timeout: 10_000 });

      const agentEndpoint = `/api/copilot/aggregated/sessions/${sessionId}/agent`;
      const getCountBeforeResume = agentResponses.filter(
        (entry) => entry.method === "GET" && entry.url.includes(agentEndpoint),
      ).length;

      await createdSessionItem.click();
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(promptInput).toBeVisible({ timeout: 10_000 });
      await expect(agentSelect).toBeVisible({ timeout: 10_000 });

      await expect
        .poll(
          () =>
            agentResponses.filter(
              (entry) => entry.method === "GET" && entry.url.includes(agentEndpoint),
            ).length,
          { timeout: 10_000 },
        )
        .toBeGreaterThan(getCountBeforeResume);

      const resumeGetResponses = agentResponses.filter(
        (entry) => entry.method === "GET" && entry.url.includes(agentEndpoint),
      );
      expect(resumeGetResponses.at(-1)?.status).toBe(200);

      const switchResponsePromise = page.waitForResponse((response) => {
        return (
          response.request().method() === "POST" &&
          response.url().includes(agentEndpoint)
        );
      });

      await agentSelect.selectOption(customAgent.id);

      const switchResponse = await switchResponsePromise;
      expect(switchResponse.status()).toBe(200);
      await expect(agentSelect).toHaveValue(customAgent.id);

      await expect
        .poll(async () => {
          const currentAgentRes = await request.get(agentEndpoint);
          if (!currentAgentRes.ok()) {
            return `status:${currentAgentRes.status()}`;
          }

          const currentAgent = (await currentAgentRes.json()) as { agentId: string | null };
          return currentAgent.agentId;
        })
        .toBe(customAgent.id);

      expect(agentResponses.filter((entry) => entry.status === 409)).toEqual([]);
    } finally {
      if (sessionId) {
        await request.post(`/api/copilot/aggregated/sessions/${sessionId}/delete`, {
          data: {},
        });
      }
    }
  });
});
