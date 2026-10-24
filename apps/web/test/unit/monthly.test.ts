import { describe, expect, it } from "vitest";
import {
  currenciesOf,
  defaultCurrency,
  fromMinor,
  lastCompletedMonth,
  monthOverMonth,
  monthsBetween,
  presetRange,
  seriesFor,
  summarize,
  toMinor,
} from "@/lib/analytics/monthly";
import type { MonthlySalesRow } from "@/lib/api/schemas";

const row = (month: string, currency: string, net: string, count: number, units: [string, string][] = []): MonthlySalesRow => ({
  month,
  currency,
  totalNetSales: net,
  transactionCount: count,
  unitsSold: units.map(([unit, quantity]) => ({ unit, quantity })),
});

describe("date ranges use completed months only", () => {
  it("excludes the current, still-open month", () => {
    expect(lastCompletedMonth(new Date(2026, 9, 23))).toBe("2026-09");
    expect(lastCompletedMonth(new Date(2026, 0, 5))).toBe("2025-12");
  });
  it.each([
    [3, "2026-07"],
    [6, "2026-04"],
    [12, "2025-10"],
  ] as const)("%i-month preset", (preset, from) => {
    expect(presetRange(preset, new Date(2026, 9, 23))).toEqual({ from, to: "2026-09" });
  });
  it("lists months across a year boundary", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("money is exact decimal arithmetic", () => {
  it("round-trips and sums without floating-point error", () => {
    expect(fromMinor(toMinor("0.1", 2) + toMinor("0.2", 2), 2)).toBe("0.30");
    expect(fromMinor(toMinor("-899.79", 2), 2)).toBe("-899.79");
    expect(fromMinor(toMinor("8085.714", 3), 3)).toBe("8085.714");
  });
});

describe("currency separation", () => {
  const rows = [
    row("2026-08", "INR", "1000.10", 10, [["EA", "5"], ["KG", "1.5"]]),
    row("2026-08", "USD", "50.00", 2, [["EA", "1"]]),
    row("2026-09", "INR", "1500.20", 12, [["EA", "7"]]),
    row("2026-09", "USD", "70.00", 3),
  ];

  it("never adds different currencies together", () => {
    const months = monthsBetween("2026-08", "2026-09");
    expect(summarize(seriesFor(rows, "INR", months), "INR").netSales).toBe("2500.30");
    expect(summarize(seriesFor(rows, "USD", months), "USD").netSales).toBe("120.00");
    expect(currenciesOf(rows)).toEqual(["INR", "USD"]);
    expect(defaultCurrency(rows)).toBe("INR");
  });

  it("sums units per unit of measure only", () => {
    const s = summarize(seriesFor(rows, "INR", ["2026-08", "2026-09"]), "INR");
    expect(s.units).toEqual([{ unit: "EA", quantity: "12.000" }, { unit: "KG", quantity: "1.500" }]);
    expect(s.transactionCount).toBe(22);
  });

  it("marks months without published data as null, not zero", () => {
    const s = seriesFor(rows, "INR", ["2026-07", "2026-08"]);
    expect(s[0]).toEqual({ month: "2026-07", netSales: null, transactionCount: null, units: [] });
    expect(summarize(s, "INR")).toMatchObject({ monthsWithData: 1, monthsInRange: 2 });
  });
});

describe("month-over-month growth", () => {
  it("is computed from the last two months", () => {
    const s = seriesFor([row("2026-08", "INR", "1000.00", 1), row("2026-09", "INR", "1100.00", 1)], "INR", ["2026-08", "2026-09"]);
    expect(monthOverMonth(s)).toEqual({ kind: "value", percent: 10, month: "2026-09", previousMonth: "2026-08" });
  });
  it("handles a negative change and a negative base month", () => {
    const down = seriesFor([row("2026-08", "INR", "1000.00", 1), row("2026-09", "INR", "750.00", 1)], "INR", ["2026-08", "2026-09"]);
    expect(monthOverMonth(down)).toMatchObject({ percent: -25 });
    const fromNegative = seriesFor([row("2026-08", "INR", "-200.00", 1), row("2026-09", "INR", "100.00", 1)], "INR", ["2026-08", "2026-09"]);
    expect(monthOverMonth(fromNegative)).toMatchObject({ percent: 150 });
  });
  it("refuses when data is missing or the base is zero", () => {
    expect(monthOverMonth(seriesFor([row("2026-09", "INR", "1.00", 1)], "INR", ["2026-08", "2026-09"])).kind).toBe("unavailable");
    expect(monthOverMonth(seriesFor([row("2026-08", "INR", "0.00", 1), row("2026-09", "INR", "5.00", 1)], "INR", ["2026-08", "2026-09"]))).toEqual({
      kind: "unavailable",
      reason: "Previous month is zero; growth is undefined.",
    });
  });
});
