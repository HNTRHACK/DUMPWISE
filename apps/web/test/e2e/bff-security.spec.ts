import { expect, test } from "@playwright/test";
import { login, mockStats, ORG_A, resetMock } from "./fixtures";

test.beforeEach(resetMock);

test("state-changing BFF requests require the CSRF header and same origin", async ({ page }) => {
  await login(page, "owner");
  const id = "00000000-0000-4000-8000-000000000000";
  const noHeader = await page.request.post(`/api/v1/imports/${id}/publish`, { headers: { "x-organization-id": ORG_A } });
  expect(noHeader.status()).toBe(403);
  const foreign = await page.request.post(`/api/v1/imports/${id}/publish`, {
    headers: { "x-organization-id": ORG_A, "x-dumpwise-csrf": "1", origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);
  const logout = await page.request.post("/api/auth/logout", { headers: { origin: "https://evil.example", "x-dumpwise-csrf": "1" } });
  expect(logout.status()).toBe(403);
});

test("the BFF is not an open proxy", async ({ page }) => {
  await login(page, "owner");
  for (const path of ["/api/v1/auth/refresh", "/api/v1/auth/login", "/api/v1/health", "/api/v1/imports/not-a-uuid"]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
});

test("organization header is validated before anything is sent upstream", async ({ page }) => {
  await login(page, "owner");
  const res = await page.request.get("/api/v1/sales/monthly", { headers: { "x-organization-id": "not-a-uuid" } });
  expect(res.status()).toBe(400);
});

test("a browser-supplied X-Forwarded-For is never passed to the API (anti-spoofing)", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.9" });
  await login(page, "analyst");
  const stats = await mockStats();
  expect(stats.lastForwardedFor).toBeNull(); // default: Next.js is the edge, so no IP is trusted
  expect(stats.lastUserAgent).toContain("Chrome"); // device metadata for the API's session list
});

test("pages and API responses carry security headers", async ({ request }) => {
  const page = await request.get("/");
  const h = page.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-powered-by"]).toBeUndefined();
  const api = await request.get("/api/auth/session");
  expect(api.status()).toBe(401);
  expect(api.headers()["cache-control"]).toContain("no-store");
});
