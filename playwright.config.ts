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
    // The driver newspaper's pages read the fixture edition in
    // test-fixtures/ instead of the backend.
    env: { FREIGHT_FATE_PAPER_FIXTURE: "1" },
    url: "http://127.0.0.1:3108/freight-fate",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
