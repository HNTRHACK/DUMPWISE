import { expect, test } from "@playwright/test";
import { login, resetMock } from "./fixtures";

test.beforeEach(resetMock);

test("all public routes render with a heading", async ({ page }) => {
  for (const [path, name] of [
    ["/", /Your data/],
    ["/product", /close the month/],
    ["/security", /Trust is a property/],
    ["/contact", /month-end/],
    ["/login", "Sign in"],
  ] as const) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: path === "/login" ? 2 : 1, name })).toBeVisible();
  }
  const missing = await page.goto("/no-such-page");
  expect(missing?.status()).toBe(404);
});

test("Enter Workspace links to login when signed out and to the workspace when signed in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Enter Workspace" }).first()).toHaveAttribute("href", "/login");
  await login(page, "viewer");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Enter Workspace" }).first()).toHaveAttribute("href", "/app");
});

test("WebGL Data Core renders, and is cleaned up after client navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?tier=full");
  const canvas = page.locator("[data-render-tier=full] canvas");
  await expect(canvas).toHaveCount(1, { timeout: 15_000 });
  // The render loop is running while the hero is visible...
  await expect.poll(async () => Number(await canvas.getAttribute("data-frames")), { timeout: 10_000 }).toBeGreaterThan(30);
  await page.mouse.wheel(0, 2400);
  await page.waitForTimeout(500);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Product" }).click();
  await expect(page).toHaveURL(/\/product$/);
  // Next 16 keeps recently visited routes alive but hidden (React <Activity>, display:none)
  // so "Back" is instant. What matters: the canvas is hidden and its render loop has STOPPED.
  await expect(page.locator("canvas")).toBeHidden();
  const before = Number(await page.locator("canvas").getAttribute("data-frames"));
  await page.waitForTimeout(1500);
  const after = Number(await page.locator("canvas").getAttribute("data-frames"));
  expect(after).toBe(before);
  // Going back resumes the same scene.
  await page.goBack();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute("data-frames")), { timeout: 10_000 }).toBeGreaterThan(after);
  expect(errors).toEqual([]);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("shows the static composition and no WebGL", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-render-tier=static]")).toHaveCount(1);
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /converging into an ordered, glowing data core/ })).toBeVisible();
    // All four phases are readable without scrolling animation.
    for (const label of ["Raw data", "Validation", "Reconciliation", "Insight"]) await expect(page.getByText(new RegExp(label)).first()).toBeVisible();
  });
});

test("falls back to SVG when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error test override: simulate a browser without WebGL
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      return /webgl/.test(type) ? null : original.call(this, type as "2d", ...(rest as []));
    };
  });
  await page.goto("/");
  await expect(page.locator("[data-render-tier=static]")).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Enter Workspace" }).first()).toBeVisible();
});

test("synthetic demo: keyboard operable and clearly labelled", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Synthetic demo data")).toBeVisible();
  const first = page.getByRole("tab", { name: /Raw export/ });
  await first.scrollIntoViewIfNeeded();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Validated/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Duplicate of line 3")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Reconciled to control totals")).toBeVisible();
});

test("keyboard: skip link is the first focusable element", async ({ page }) => {
  await page.goto("/product");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test.describe("mobile 375px", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test("no horizontal overflow on public pages, login and workspace", async ({ page }) => {
    for (const path of ["/", "/product", "/security", "/login"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await page.goto("/");
    // Phones get the lite tier (or static), never the full one.
    await expect(page.locator("[data-render-tier=full]")).toHaveCount(0);
    await login(page, "analyst");
    for (const path of ["/app", "/app/sales", "/app/imports", "/app/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Imports" }).click();
    await expect(page).toHaveURL(/\/app\/imports$/);
  });
});
