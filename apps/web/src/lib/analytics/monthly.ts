import type { MonthlySalesRow } from "@/lib/api/schemas";

// Pure, tested calculations on top of GET /v1/sales/monthly. Rules:
//  - money is summed as integer minor units (BigInt), never as floating point;
//  - currencies are never added together (no FX conversion exists);
//  - a month without published data is "no data" (null), never silently zero;
//  - growth is only computed when both months have data and the base is not zero.

export type Preset = 3 | 6 | 12;

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** The most recent fully completed calendar month (the current month is still open). */
export function lastCompletedMonth(now: Date): string {
  return addMonths(monthKey(now), -1);
}

/** 3, 6 or 12 completed months ending with the last completed month. */
export function presetRange(preset: Preset, now: Date): { from: string; to: string } {
  const to = lastCompletedMonth(now);
  return { from: addMonths(to, -(preset - 1)), to };
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** "-1234.5" -> -123450n (in 1/10^scale units). */
export function toMinor(decimal: string, scale: number): bigint {
  const negative = decimal.startsWith("-");
  const [int, frac = ""] = decimal.replace(/^[-+]/, "").split(".");
  const value = BigInt(int || "0") * 10n ** BigInt(scale) + BigInt((frac + "0".repeat(scale)).slice(0, scale) || "0");
  return negative ? -value : value;
}

export function fromMinor(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const s = abs.toString().padStart(scale + 1, "0");
  const out = scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  return negative ? `-${out}` : out;
}

export function currenciesOf(rows: MonthlySalesRow[]): string[] {
  return [...new Set(rows.map((r) => r.currency))].sort();
}

/** Default currency: the one with the most line items in the data (ties: alphabetical). */
export function defaultCurrency(rows: MonthlySalesRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.currency, (counts.get(r.currency) ?? 0) + r.transactionCount);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export interface MonthPoint {
  month: string;
  /** null = no published data for this month in this currency. */
  netSales: string | null;
  transactionCount: number | null;
  units: { unit: string; quantity: string }[];
}

export function seriesFor(rows: MonthlySalesRow[], currency: string, months: string[]): MonthPoint[] {
  const byMonth = new Map(rows.filter((r) => r.currency === currency).map((r) => [r.month, r]));
  return months.map((month) => {
    const r = byMonth.get(month);
    return r
      ? { month, netSales: r.totalNetSales, transactionCount: r.transactionCount, units: r.unitsSold }
      : { month, netSales: null, transactionCount: null, units: [] };
  });
}

export interface Summary {
  currency: string;
  netSales: string;
  transactionCount: number;
  /** Units are summed per unit of measure; different units are never added together. */
  units: { unit: string; quantity: string }[];
  monthsWithData: number;
  monthsInRange: number;
}

export function summarize(series: MonthPoint[], currency: string): Summary {
  let net = 0n;
  let count = 0;
  let withData = 0;
  const units = new Map<string, bigint>();
  for (const p of series) {
    if (p.netSales === null) continue;
    withData++;
    net += toMinor(p.netSales, 2);
    count += p.transactionCount ?? 0;
    for (const u of p.units) units.set(u.unit, (units.get(u.unit) ?? 0n) + toMinor(u.quantity, 3));
  }
  return {
    currency,
    netSales: fromMinor(net, 2),
    transactionCount: count,
    units: [...units.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([unit, q]) => ({ unit, quantity: fromMinor(q, 3) })),
    monthsWithData: withData,
    monthsInRange: series.length,
  };
}

export type Growth =
  | { kind: "value"; percent: number; month: string; previousMonth: string }
  | { kind: "unavailable"; reason: string };

/** Month-over-month growth of the LAST month in the range versus the month before. */
export function monthOverMonth(series: MonthPoint[]): Growth {
  if (series.length < 2) return { kind: "unavailable", reason: "Needs at least two months in the range." };
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last.netSales === null || prev.netSales === null) {
    return { kind: "unavailable", reason: `No published data for ${last.netSales === null ? last.month : prev.month}.` };
  }
  const base = toMinor(prev.netSales, 2);
  if (base === 0n) return { kind: "unavailable", reason: "Previous month is zero; growth is undefined." };
  const diff = toMinor(last.netSales, 2) - base;
  // Percentage in basis points with integer math, then one division for display.
  const bps = Number((diff * 10000n) / (base < 0n ? -base : base));
  return { kind: "value", percent: bps / 100, month: last.month, previousMonth: prev.month };
}
