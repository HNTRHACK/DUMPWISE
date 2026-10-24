import { expect, test } from "@playwright/test";
import { login, mock, mockStats, PASSWORD, resetMock } from "./fixtures";

test.beforeEach(resetMock);

test("unauthenticated visitors are redirected from the workspace to login", async ({ page }) => {
  await page.goto("/app/sales");
  // The server-side gate cannot see the requested sub-path; it returns to the workspace root.
  await expect(page).toHaveURL(/\/login\?next=\/app$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("wrong password shows a generic error and sets no session cookie", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("analyst@demo.invalid");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid" })).toHaveText("Invalid email or password.");
  expect((await context.cookies()).map((c) => c.name)).not.toContain("__Host-dw_rt");
});

test("login stores tokens in HttpOnly cookies that page scripts cannot read", async ({ page, context }) => {
  await login(page, "analyst");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const cookies = await context.cookies();
  const access = cookies.find((c) => c.name.endsWith("dw_at"));
  const refresh = cookies.find((c) => c.name.endsWith("dw_rt"));
  expect(access?.httpOnly).toBe(true);
  expect(refresh?.httpOnly).toBe(true);
  expect(refresh?.sameSite).toBe("Lax");
  const visible = await page.evaluate(() => document.cookie);
  expect(visible).not.toMatch(/dw_at|dw_rt|dwa_|dwr_/);
  // The BFF talks to the API server-to-server: browser cookies are never forwarded upstream.
  expect((await mockStats()).cookieHeadersSeen).toBe(0);
});

test("only internal workspace paths are accepted as the post-login destination", async ({ page }) => {
  await page.goto("/login?next=//evil.example/app");
  await page.getByLabel("Work email").fill("analyst@demo.invalid");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:3100\/app$/);
});

test("expired access token is refreshed transparently, exactly once for concurrent requests", async ({ page }) => {
  await login(page, "owner");
  await expect(page.getByText("Latest imports")).toBeVisible();
  await mock("expire-access");
  // Overview fires the monthly-sales and imports requests concurrently: both get 401 upstream.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText(/Net sales · INR/)).toBeVisible();
  const stats = await mockStats();
  expect(stats.refreshCalls).toBe(1);
  expect(stats.reuseDetected).toBe(0); // no second use of the rotated refresh token
});

test("a session revoked on the server ends the workspace session", async ({ page }) => {
  await login(page, "analyst");
  await expect(page.getByText(/Net sales · INR/)).toBeVisible();
  await mock("revoke-all");
  await page.getByRole("link", { name: "Sales" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fsales&reason=expired/);
  await expect(page.getByText("Your session ended")).toBeVisible();
});

test("sign out revokes the server session and clears cookies", async ({ page, context }) => {
  await login(page, "viewer");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/reason=signed-out$/);
  await expect(page.getByText("session was revoked")).toBeVisible();
  const sessions = await (await fetch("http://127.0.0.1:3101/__test/sessions")).json();
  expect(sessions.every((s: { revoked: boolean }) => s.revoked)).toBe(true);
  expect((await context.cookies()).filter((c) => /dw_(at|rt)$/.test(c.name))).toHaveLength(0);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});

test("password change uses the API contract and reports wrong current password", async ({ page }) => {
  await login(page, "analyst");
  await page.goto("/app/settings");
  await page.getByLabel("Current password").fill("wrong current password");
  await page.getByLabel("New password", { exact: true }).fill("a brand new passphrase");
  await page.getByLabel("Confirm new password").fill("a brand new passphrase");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "password" })).toHaveText("The current password is incorrect.");
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed. All your other sessions were signed out.")).toBeVisible();
});
