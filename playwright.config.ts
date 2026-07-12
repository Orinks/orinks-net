import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3108",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- -p 3108",
    url: "http://127.0.0.1:3108/freight-fate",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
