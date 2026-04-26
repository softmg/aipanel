import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3107",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm exec next build && pnpm exec next start -H 127.0.0.1 -p 3107",
    url: "http://127.0.0.1:3107",
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      AIPANEL_CONFIG_DIR: ".tmp/e2e/aipanel",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
