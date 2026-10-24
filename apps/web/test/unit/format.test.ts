import { describe, expect, it } from "vitest";
import { currencySymbol, formatMoney, formatMoneyScaled, localeForCurrency, moneyAxis } from "@/lib/format";

// Abbreviations that must never appear in money output (ambiguous or mixed number systems).
const ABBREVIATION = /\d\s?(K|L|Cr|M|B|T|Mn|Bn)\b/;

describe("currency locale", () => {
  it("uses Indian grouping for INR and US grouping for USD", () => {
    expect(localeForCurrency("INR")).toBe("en-IN");
    expect(localeForCurrency("USD")).toBe("en-US");
    expect(localeForCurrency("EUR")).toBe("en-US");
  });
});

describe("formatMoney (exact)", () => {
  it.each([
    ["INR positive", "102778.94", "INR", "₹1,02,778.94"],
    ["INR negative", "-2410.15", "INR", "-₹2,410.15"],
    ["INR large", "574132689.75", "INR", "₹57,41,32,689.75"],
    ["INR beyond 2^53 stays exact", "9007199254740993.99", "INR", "₹9,00,71,99,25,47,40,993.99"],
    ["INR zero", "0", "INR", "₹0.00"],
    ["USD positive", "102778.94", "USD", "$102,778.94"],
    ["USD negative", "-2410.15", "USD", "-$2,410.15"],
    ["USD large", "1062439.58", "USD", "$1,062,439.58"],
    ["USD beyond 2^53 stays exact", "9007199254740993.99", "USD", "$9,007,199,254,740,993.99"],
    ["USD small fraction", "0.5", "USD", "$0.50"],
  ])("%s", (_name, value, currency, expected) => {
    expect(formatMoney(value, currency)).toBe(expected);
  });

  it("never uses Indian grouping for USD", () => {
    expect(formatMoney("102778.94", "USD")).not.toContain("1,02,");
  });
});

describe("formatMoneyScaled (KPI headlines)", () => {
  it.each([
    ["INR crore", "574132689.75", "INR", "₹57.41 crore"],
    ["INR negative crore", "-44792897.06", "INR", "-₹4.48 crore"],
    ["INR lakh", "1062439.58", "INR", "₹10.62 lakh"],
    ["INR below 1 lakh stays exact", "83105.50", "INR", "₹83,105.50"],
    ["INR rounds up into the next unit", "9999500.00", "INR", "₹1.00 crore"],
    ["INR very large keeps Indian grouping", "123456789012345.67", "INR", "₹1,23,45,678.90 crore"],
    ["USD million", "574132689.75", "USD", "$574.13 million"],
    ["USD negative million", "-1062439.58", "USD", "-$1.06 million"],
    ["USD billion", "2500000000", "USD", "$2.50 billion"],
    ["USD below 1 million stays exact", "102778.94", "USD", "$102,778.94"],
    ["USD very large", "123456789012345.67", "USD", "$123,456.79 billion"],
  ])("%s", (_name, value, currency, expected) => {
    expect(formatMoneyScaled(value, currency)).toBe(expected);
  });

  it("rounds half away from zero with exact arithmetic", () => {
    expect(formatMoneyScaled("1005000.00", "INR")).toBe("₹10.05 lakh");
    expect(formatMoneyScaled("1000500.00", "INR")).toBe("₹10.01 lakh"); // 10.005 -> 10.01
    expect(formatMoneyScaled("-1000500.00", "INR")).toBe("-₹10.01 lakh");
  });

  it("never emits abbreviations", () => {
    for (const v of ["574132689.75", "1062439.58", "2500000000", "-44792897.06", "160000"]) {
      expect(formatMoneyScaled(v, "INR")).not.toMatch(ABBREVIATION);
      expect(formatMoneyScaled(v, "USD")).not.toMatch(ABBREVIATION);
    }
  });
});

describe("moneyAxis (chart axis)", () => {
  it("INR chart in crore: one unit, plain ticks", () => {
    const axis = moneyAxis("INR", 56_538_999.29);
    expect(axis.caption).toBe("Amounts in ₹ crore");
    expect([0, 15_000_000, 30_000_000, 45_000_000, 60_000_000].map(axis.tick)).toEqual(["0", "1.5", "3", "4.5", "6"]);
  });

  it("USD chart in thousand uses US grouping and no Indian units", () => {
    const axis = moneyAxis("USD", 150_597.6);
    expect(axis.caption).toBe("Amounts in $ thousand");
    expect([0, 40_000, 80_000, 120_000, 160_000].map(axis.tick)).toEqual(["0", "40", "80", "120", "160"]);
  });

  it("chooses lakh, million and billion where appropriate", () => {
    expect(moneyAxis("INR", 950_000).caption).toBe("Amounts in ₹ lakh");
    expect(moneyAxis("USD", 7_500_000).caption).toBe("Amounts in $ million");
    expect(moneyAxis("USD", 3e9).caption).toBe("Amounts in $ billion");
  });

  it("handles negative ticks and small ranges", () => {
    expect(moneyAxis("INR", 30_000_000).tick(-15_000_000)).toBe("-1.5");
    const small = moneyAxis("USD", 500);
    expect(small.caption).toBe("Amounts in $");
    expect(small.tick(250)).toBe("250");
  });

  it("uses each currency's own symbol", () => {
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol("USD")).toBe("$");
  });
});
