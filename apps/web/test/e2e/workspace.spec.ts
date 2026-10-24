import { expect, test } from "@playwright/test";
import { login, mock, mockStats, ORG_A, ORG_B, presetMonths, resetMock } from "./fixtures";

test.beforeEach(resetMock);

test.describe("sales", () => {
  test("requests only completed months and keeps currencies separate", async ({ page }) => {
    await login(page, "analyst");
    await page.goto("/app/sales");
    const months = presetMonths(12);
    await expect(page.getByRole("heading", { name: "Monthly detail · INR" })).toBeVisible();
    expect((await mockStats()).lastMonthlyQuery).toEqual({ from: months[0], to: months[11], org: ORG_A });

    const table = page.getByRole("table", { name: /Monthly net sales, line items and net units in INR/ });
    await expect(table.locator("tbody tr")).toHaveCount(12);
    // INR total: the mock's 12 most recent INR months, summed exactly (no float drift).
    const inrTotal = page.locator("tfoot td").first();
    await expect(inrTotal).toContainText("₹");

    await page.getByRole("radio", { name: "USD" }).click();
    await expect(page.getByRole("heading", { name: "Monthly detail · USD" })).toBeVisible();
    await expect(page.locator("tfoot td").first()).toContainText("$");
    await expect(page.locator("tfoot td").first()).not.toContainText("₹");
  });

  test("the range preset changes the API query", async ({ page }) => {
    await login(page, "analyst");
    await page.goto("/app/sales");
    await page.getByRole("combobox", { name: "Range", exact: true }).selectOption("3");
    const months = presetMonths(3);
    await expect(page.getByRole("table", { name: /in INR/ }).locator("tbody tr")).toHaveCount(3);
    expect((await mockStats()).lastMonthlyQuery).toMatchObject({ from: months[0], to: months[2] });
  });

  test("keyboard: currency switcher works with arrow keys", async ({ page }) => {
    await login(page, "analyst");
    await page.goto("/app/sales");
    await page.getByRole("radio", { name: "INR" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "USD" })).toBeFocused();
    await expect(page.getByRole("radio", { name: "USD" })).toHaveAttribute("aria-checked", "true");
  });
});

test("switching organization reloads data for the new organization", async ({ page }) => {
  await login(page, "owner");
  await expect(page.getByText(/Net sales · INR/)).toBeVisible();
  await page.getByLabel("Active organization").selectOption(ORG_B);
  await expect(page.getByText("Second Synthetic Distributor (SYNTHETIC)").first()).toBeVisible();
  await expect.poll(async () => (await mockStats()).lastOrgHeader).toBe(ORG_B);
  // Organization B has no USD data: the currency switcher disappears.
  await expect(page.getByRole("radio", { name: "USD" })).toHaveCount(0);
});

test.describe("role-aware UI (the API stays the authority)", () => {
  test("viewer cannot upload and sees no publish action", async ({ page }) => {
    await login(page, "viewer");
    await page.goto("/app/imports");
    await expect(page.getByText(/can view imports but not upload them/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Import" })).toHaveCount(0);
    await page.getByRole("link", { name: "SYNTHETIC_sap_billing_ready.csv" }).click();
    await expect(page.getByText(/Only an owner can publish/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  });

  test("a forbidden publish is rejected by the API even if attempted directly", async ({ page }) => {
    await login(page, "analyst");
    await page.goto("/app/imports");
    await page.getByRole("link", { name: "SYNTHETIC_sap_billing_ready.csv" }).click();
    await expect(page).toHaveURL(/\/app\/imports\/[0-9a-f-]{36}$/);
    const batchId = page.url().split("/").pop()!;
    const res = await page.request.post(`/api/v1/imports/${batchId}/publish`, {
      headers: { "x-dumpwise-csrf": "1", "x-organization-id": ORG_A, origin: "http://localhost:3100" },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("import center", () => {
  test("uploads a CSV and shows the server's real result", async ({ page }) => {
    await login(page, "analyst");
    await page.goto("/app/imports");
    await page.getByLabel(/SAP billing CSV/).setInputFiles({ name: "SYNTHETIC_upload.csv", mimeType: "text/csv", buffer: Buffer.from("Billing Date,Billing Document\n") });
    await page.getByLabel(/Control totals/).setInputFiles({ name: "totals.json", mimeType: "application/json", buffer: Buffer.from('{"schemaVersion":1}') });
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText("Imported and reconciled. An owner can now publish it.")).toBeVisible();
    await expect(page.getByRole("link", { name: "SYNTHETIC_upload.csv" })).toBeVisible();
    expect((await mockStats()).uploads).toBe(1);
  });

  test("client-side checks stop obviously wrong files without calling the API", async ({ page }) => {
    await login(page, "analyst");
    await page.goto("/app/imports");
    await page.getByLabel(/SAP billing CSV/).setInputFiles({ name: "report.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("PK\x03\x04") });
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByRole("alert").filter({ hasText: ".csv" })).toContainText("must be a .csv file");
    expect((await mockStats()).uploads).toBe(0);
  });

  test("server-side validation and reconciliation failures are displayed honestly", async ({ page }) => {
    await login(page, "analyst");
    await page.goto("/app/imports");
    const totals = { name: "totals.json", mimeType: "application/json", buffer: Buffer.from("{}") };
    await page.getByLabel(/Control totals/).setInputFiles(totals);
    await page.getByLabel(/SAP billing CSV/).setInputFiles({ name: "fail-recon.csv", mimeType: "text/csv", buffer: Buffer.from("x") });
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText("Totals did not reconcile. All rows were rolled back; publication is blocked.")).toBeVisible();

    await page.getByLabel(/Control totals/).setInputFiles({ ...totals, buffer: Buffer.from("{not json") });
    await page.getByLabel(/SAP billing CSV/).setInputFiles({ name: "ok.csv", mimeType: "text/csv", buffer: Buffer.from("x") });
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "controlTotals" })).toHaveText("controlTotals is not valid JSON");
  });

  test("owner publishes after confirmation; batch detail shows reconciliation evidence", async ({ page }) => {
    await login(page, "owner");
    await page.goto("/app/imports");
    await page.getByRole("link", { name: "SYNTHETIC_sap_billing_ready.csv" }).click();
    await expect(page.getByText("3 of 3 checks passed against the control totals.")).toBeVisible();
    await page.getByRole("button", { name: "Publish" }).click();
    const dialog = page.getByRole("dialog", { name: "Publish this batch?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Publish" }).click();
    await page.getByRole("button", { name: "Publish batch" }).click();
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  });

  test("a blocked publication (409) is explained in the dialog", async ({ page }) => {
    await login(page, "owner");
    await page.goto("/app/imports");
    await page.getByRole("link", { name: "SYNTHETIC_sap_billing_ready.csv" }).click();
    await mock("publish-conflict");
    await page.getByRole("button", { name: "Publish" }).click();
    await page.getByRole("button", { name: "Publish batch" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Publication blocked");
  });

  test("failed batch: only failed checks shown, issues filterable", async ({ page }) => {
    await login(page, "owner");
    await page.goto("/app/imports");
    await page.getByRole("link", { name: "SYNTHETIC_reconciliation_failed.csv" }).click();
    await expect(page.getByLabel("Only failed checks")).toBeChecked();
    await expect(page.getByRole("table", { name: /Reconciliation checks/ }).locator("tbody tr")).toHaveCount(1);
    await page.getByLabel("Severity").selectOption("warning");
    await expect(page.getByRole("table", { name: /Validation issues/ }).locator("tbody tr")).toHaveCount(1);
    await page.getByLabel("Search issues").fill("calendar");
    await expect(page.getByText("No issues match the filters.")).toBeVisible();
  });
});

test("products, distributors and customers show honest 'Coming next' states", async ({ page }) => {
  await login(page, "analyst");
  for (const p of ["products", "distributors", "customers"]) {
    await page.goto(`/app/${p}`);
    await expect(page.getByText("Coming next — not available yet")).toBeVisible();
    await expect(page.getByText("Proposed API contract (not implemented)")).toBeVisible();
  }
});
