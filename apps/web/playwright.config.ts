import { defineConfig, devices } from "@playwright/test";

// Browser tests run the PRODUCTION build of the web app against a mock of the NestJS API
// (test/e2e/mock-api.mjs, synthetic data only). Nothing touches PostgreSQL.
// Prerequisite: `npm run build`.
const WEB = "http://localhost:3100";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false, // the mock API keeps shared state
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: WEB, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: "node test/e2e/mock-api.mjs", url: "http://127.0.0.1:3101/health", reuseExistingServer: false, stdout: "ignore" },
    {
      command: "npx next start -p 3100",
      url: `${WEB}/login`,
      reuseExistingServer: false,
      env: { DUMPWISE_API_URL: "http://127.0.0.1:3101" },
    },
  ],
});
