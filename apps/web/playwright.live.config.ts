import { defineConfig, devices } from "@playwright/test";

// LIVE integration tests: real browser -> Next.js BFF -> real NestJS API -> dumpwise_dev.
// They WRITE to the development database (sessions, audit events, rate-limit counters, and
// imports into the dedicated "synthetic-isolation" organization). Run only with approval.
// Prerequisites: API on 127.0.0.1:3001 started with AUTH_ACCESS_TOKEN_TTL_SECONDS=60, web on
// 127.0.0.1:3000, and passwords in DW_OWNER_PW / DW_ANALYST_PW / DW_ISOLATION_PW.
export default defineConfig({
  testDir: "test/live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", trace: "off", screenshot: "off" },
  projects: [{ name: "live-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
