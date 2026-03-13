import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: [
    {
      command: "PORT=3000 HOST=0.0.0.0 npx tsx src/server/index.ts",
      port: 3000,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npx vite --port 5173 --host --config vite.config.ts",
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
