import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Real-data workflow against the running NestJS API. No mocks. Synthetic data only.
test.describe.configure({ mode: "serial" });

const SHOTS = join(__dirname, "../../../../docs/screenshots/phase-3-5");
const DATA = join(__dirname, "../../../../data/synthetic/SYNTHETIC_sap_billing_2025-10_to_2026-09");
const DEMO_ORG_SLUG = "synthetic-demo";
const pw = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

type Control = { totals: { month: string; currency: string; netAmount: string; lineCount: number }[] };
const control = JSON.parse(readFileSync(`${DATA}.control_totals.json`, "utf8")) as Control;

/** Expected total for one currency over the dashboard's 12 completed months, from the Python control totals. */
function expectedTotal(currency: string, months: string[]): string {
  let minor = 0n;
  for (const t of control.totals) if (t.currency === currency && months.includes(t.month)) minor += BigInt(t.netAmount.replace(".", ""));
  const s = minor.toString().padStart(3, "0");
  // Independent of the app's formatter: INR in Indian grouping, USD in US grouping.
  const locale = { INR: "en-IN", USD: "en-US" }[currency] ?? "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(`${s.slice(0, -2)}.${s.slice(-2)}` as `${number}`);
}
function last12CompletedMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 12 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/reason=signed-out$/);
}
async function orgIdFromSession(page: Page, slug: string): Promise<string> {
  const me = await (await page.request.get("/api/auth/session")).json();
  return me.memberships.find((m: { organizationSlug: string }) => m.organizationSlug === slug).organizationId;
}

test("wrong password: generic error from the real API, no cookies", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("demo.analyst@example.invalid");
  await page.getByLabel("Password").fill("definitely not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid" })).toHaveText("Invalid email or password.");
  expect((await context.cookies()).some((c) => /dw_(at|rt)$/.test(c.name))).toBe(false);
});

test("analyst: real login, HttpOnly cookies, dashboard equals independent control totals", async ({ page, context }) => {
  await login(page, "demo.analyst@example.invalid", pw("DW_ANALYST_PW"));
  const cookies = await context.cookies();
  expect(cookies.filter((c) => /dw_(at|rt)$/.test(c.name)).every((c) => c.httpOnly && c.sameSite === "Lax")).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/dwa_|dwr_/);
  await page.screenshot({ path: `${SHOTS}/01-overview-analyst.png` });

  await page.goto("/app/sales");
  await page.getByRole("combobox", { name: "Range", exact: true }).selectOption("12");
  const months = last12CompletedMonths();
  const footer = page.locator("tfoot td").first();
  await expect(footer).toHaveText(expectedTotal("INR", months));
  await page.getByRole("radio", { name: "USD" }).click();
  await expect(page.locator("tfoot td").first()).toHaveText(expectedTotal("USD", months));
  await page.screenshot({ path: `${SHOTS}/02-sales-usd.png`, fullPage: true });

  // Session persists across a reload and a new tab.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
  const tab = await context.newPage();
  await tab.goto("/app/settings");
  await expect(tab.getByText("demo.analyst@example.invalid")).toBeVisible();
  await expect(tab.getByRole("table", { name: /memberships/ })).toContainText("ANALYST");
  await tab.close();
});

test("refresh rotation: expired access cookie is renewed once, session stays valid", async ({ page, context }) => {
  await login(page, "demo.analyst@example.invalid", pw("DW_ANALYST_PW"));
  const before = (await context.cookies()).find((c) => c.name.endsWith("dw_rt"))!.value;
  // API runs with a 60 s access TTL; the BFF drops the access cookie 30 s before expiry.
  await page.waitForTimeout(35_000);
  expect((await context.cookies()).some((c) => c.name.endsWith("dw_at"))).toBe(false);
  // Overview fires sales + imports concurrently: both need the refresh.
  await page.goto("/app");
  await expect(page.getByText(/Net sales · INR/)).toBeVisible();
  await expect(page.getByText("Latest imports")).toBeVisible();
  const after = (await context.cookies()).find((c) => c.name.endsWith("dw_rt"))!.value;
  expect(after).not.toBe(before); // rotated
  // The session survived (no refresh-token reuse detection): another data call works.
  expect((await page.request.get("/api/auth/session")).status()).toBe(200);
  writeFileSync(join(tmpdir(), "dw-live-refresh.txt"), "ok"); // marker only; no token stored
});

test("analyst: role-sensitive views and idempotent re-upload into the demo org", async ({ page }) => {
  await login(page, "demo.analyst@example.invalid", pw("DW_ANALYST_PW"));
  await page.goto("/app/imports");
  await page.getByRole("link", { name: /SYNTHETIC_sap_billing_2025-10_to_2026-09\.csv/ }).first().click();
  await expect(page.getByText("84 of 84 checks passed against the control totals.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await page.goto("/app/imports");
  await page.getByLabel(/SAP billing CSV/).setInputFiles(`${DATA}.csv`);
  await page.getByLabel(/Control totals/).setInputFiles(`${DATA}.control_totals.json`);
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("This exact file was imported before. Nothing changed.")).toBeVisible({ timeout: 60_000 });
  // A forbidden publish attempted directly is refused by the API (analyst != owner).
  const orgId = await orgIdFromSession(page, DEMO_ORG_SLUG);
  const list = await (await page.request.get("/api/v1/imports?limit=1&offset=0", { headers: { "x-organization-id": orgId } })).json();
  const res = await page.request.post(`/api/v1/imports/${list.items[0].id}/publish`, {
    headers: { "x-organization-id": orgId, "x-dumpwise-csrf": "1", origin: "http://localhost:3000" },
  });
  expect(res.status()).toBe(403);
  await logout(page);
});

test("organization isolation: a member of synthetic-isolation cannot reach demo data", async ({ page }) => {
  // Demo org id and one of its batch ids, as seen by the demo owner.
  await login(page, "demo.owner@example.invalid", pw("DW_OWNER_PW"));
  const demoOrg = await orgIdFromSession(page, DEMO_ORG_SLUG);
  const demoBatch = (await (await page.request.get("/api/v1/imports?limit=1&offset=0", { headers: { "x-organization-id": demoOrg } })).json()).items[0].id;
  await logout(page);

  await login(page, "isolation.owner@example.invalid", pw("DW_ISOLATION_PW"));
  const me = await (await page.request.get("/api/auth/session")).json();
  expect(me.memberships.map((m: { organizationSlug: string }) => m.organizationSlug)).toEqual(["synthetic-isolation"]);
  const isoOrg = me.memberships[0].organizationId;
  // Asking for the demo org: not a member -> 403 (the API, through RLS-backed membership checks).
  expect((await page.request.get("/api/v1/sales/monthly", { headers: { "x-organization-id": demoOrg } })).status()).toBe(403);
  expect((await page.request.get(`/api/v1/imports/${demoBatch}`, { headers: { "x-organization-id": demoOrg } })).status()).toBe(403);
  // Asking for a demo batch id inside the own org: simply not found.
  expect((await page.request.get(`/api/v1/imports/${demoBatch}`, { headers: { "x-organization-id": isoOrg } })).status()).toBe(404);
  await page.screenshot({ path: `${SHOTS}/03-isolation-overview.png` });
});

test("isolation org: upload -> validation -> reconciliation (fail, then pass) -> publish -> dashboard", async ({ page }) => {
  await login(page, "isolation.owner@example.invalid", pw("DW_ISOLATION_PW"));
  await page.goto("/app/imports");

  // 1) Deliberately mismatched control totals (one month off by ₹0.01): must be rolled back.
  const tampered = JSON.parse(readFileSync(`${DATA}.control_totals.json`, "utf8"));
  const first = tampered.totals[0];
  const minor = BigInt(first.netAmount.replace(".", "")) + 1n;
  first.netAmount = `${minor.toString().slice(0, -2)}.${minor.toString().slice(-2)}`;
  const tamperedPath = join(tmpdir(), "dw-live-tampered.control_totals.json");
  writeFileSync(tamperedPath, JSON.stringify(tampered));
  await page.getByLabel(/SAP billing CSV/).setInputFiles(`${DATA}.csv`);
  await page.getByLabel(/Control totals/).setInputFiles(tamperedPath);
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Totals did not reconcile. All rows were rolled back; publication is blocked.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/83 of 84 checks passed/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-reconciliation-failed.png`, fullPage: true });

  // 2) The real control totals: imported and reconciled.
  await page.getByLabel(/Control totals/).setInputFiles(`${DATA}.control_totals.json`);
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Imported and reconciled. An owner can now publish it.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Reconciliation: 84 of 84 checks passed.")).toBeVisible();
  await page.getByRole("link", { name: "Open batch" }).click();
  await expect(page.getByText("84 of 84 checks passed against the control totals.")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-batch-ready.png`, fullPage: true });

  // Before publishing, the dashboard has nothing for this org.
  await page.goto("/app");
  await expect(page.getByText("No published sales in this range")).toBeVisible();

  // 3) Publish with confirmation.
  await page.goto("/app/imports");
  await page.getByRole("link", { name: /SYNTHETIC_sap_billing_2025-10_to_2026-09\.csv/ }).first().click();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Publish batch" }).click();
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

  // 4) Dashboard now equals the independent control totals.
  await page.goto("/app/sales");
  const months = last12CompletedMonths();
  await expect(page.locator("tfoot td").first()).toHaveText(expectedTotal("INR", months));
  await page.goto("/app");
  await expect(page.getByText(/Net sales · INR/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-isolation-dashboard-published.png`, fullPage: true });
});

test("logout revokes the real session; the old cookies stop working", async ({ page, context }) => {
  await login(page, "demo.owner@example.invalid", pw("DW_OWNER_PW"));
  const saved = await context.cookies();
  await logout(page);
  // Replay the pre-logout cookies: the server-side session is revoked, so they are useless.
  await context.addCookies(saved);
  expect((await page.request.get("/api/auth/session")).status()).toBe(401);
});
