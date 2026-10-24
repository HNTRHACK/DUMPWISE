import { expect, type Page } from "@playwright/test";

export const MOCK = "http://127.0.0.1:3101";
export const PASSWORD = "correct horse battery 42";
export const ORG_A = "11111111-1111-4111-8111-111111111111";
export const ORG_B = "22222222-2222-4222-8222-222222222222";

export async function resetMock() {
  await fetch(`${MOCK}/__test/reset`, { method: "POST" });
}
export async function mock(action: "expire-access" | "revoke-all" | "publish-conflict") {
  await fetch(`${MOCK}/__test/${action}`, { method: "POST" });
}
export async function mockStats(): Promise<{
  refreshCalls: number;
  reuseDetected: number;
  uploads: number;
  cookieHeadersSeen: number;
  lastForwardedFor: string | null;
  lastUserAgent: string | null;
  lastMonthlyQuery: { from: string; to: string; org: string } | null;
  lastOrgHeader: string | null;
}> {
  return (await fetch(`${MOCK}/__test/stats`)).json();
}

export async function login(page: Page, who: "owner" | "analyst" | "viewer", next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Work email").fill(`${who}@demo.invalid`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(next ?? /\/app$/);
}

/** Months the dashboard should request for an N-month preset (completed months only). */
export function presetMonths(n: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
