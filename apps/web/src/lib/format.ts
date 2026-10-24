import { fromMinor, toMinor } from "@/lib/analytics/monthly";

// Display formatting with Intl. Values arrive as decimal strings; Intl.NumberFormat formats
// decimal strings exactly (no float rounding of large amounts).

/** Base locale for non-money values (counts, quantities, dates): Indian users. */
const LOCALE = "en-IN";

type NumericString = `${number}`;

/**
 * Money is formatted in the convention of its own currency: INR with Indian grouping
 * (₹12,34,567.89), USD and other currencies with international grouping ($1,234,567.89).
 */
export function localeForCurrency(currency: string): string {
  return currency === "INR" ? "en-IN" : "en-US";
}

/** Exact amount, always 2 decimals. Used for tables, tooltips and anything precise. */
export function formatMoney(value: string, currency: string): string {
  return new Intl.NumberFormat(localeForCurrency(currency), {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value as NumericString);
}

// Spelled-out scale words (never "K"/"L"/"Cr"/"M" abbreviations, never mixed systems):
// INR uses the Indian system, other currencies the international one. Largest first.
const SCALES: Record<"INR" | "INTL", { unit: string; factor: bigint }[]> = {
  INR: [
    { unit: "crore", factor: 10_000_000n },
    { unit: "lakh", factor: 100_000n },
  ],
  INTL: [
    { unit: "billion", factor: 1_000_000_000n },
    { unit: "million", factor: 1_000_000n },
  ],
};
const scalesFor = (currency: string) => (currency === "INR" ? SCALES.INR : SCALES.INTL);

/**
 * Headline amount for KPI cards: "₹57.41 crore", "$574.13 million". Rounded half away from
 * zero to 2 decimals with exact integer arithmetic. Amounts below 1 lakh (INR) or 1 million
 * (others) are shown exactly. Always pair a scaled headline with the exact amount nearby.
 */
export function formatMoneyScaled(value: string, currency: string): string {
  const minor = toMinor(value, 2); // hundredths of the currency unit
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  for (const { unit, factor } of scalesFor(currency)) {
    // abs / factor = hundredths of the scaled unit; round half away from zero.
    const hundredths = (abs * 2n + factor) / (2n * factor);
    if (hundredths >= 100n) {
      const scaled = fromMinor(negative ? -hundredths : hundredths, 2);
      return `${formatMoney(scaled, currency)} ${unit}`;
    }
  }
  return formatMoney(value, currency);
}

const AXIS_SCALES: Record<"INR" | "INTL", { unit: string; factor: number }[]> = {
  INR: [
    { unit: "crore", factor: 1e7 },
    { unit: "lakh", factor: 1e5 },
    { unit: "thousand", factor: 1e3 },
  ],
  INTL: [
    { unit: "billion", factor: 1e9 },
    { unit: "million", factor: 1e6 },
    { unit: "thousand", factor: 1e3 },
  ],
};

export function currencySymbol(currency: string): string {
  return (
    new Intl.NumberFormat(localeForCurrency(currency), { style: "currency", currency })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? currency
  );
}

/**
 * One scale for a whole chart axis, chosen from the largest absolute value: ticks are plain
 * numbers in that unit and the axis caption names it ("Amounts in ₹ crore"), so an axis never
 * mixes units. Tick values are display-only numbers produced by the chart library.
 */
export function moneyAxis(currency: string, maxAbs: number): { caption: string; tick: (value: number) => string } {
  const scale = (currency === "INR" ? AXIS_SCALES.INR : AXIS_SCALES.INTL).find((s) => maxAbs >= s.factor);
  const factor = scale?.factor ?? 1;
  const number = new Intl.NumberFormat(localeForCurrency(currency), { maximumFractionDigits: 2 });
  return {
    caption: `Amounts in ${currencySymbol(currency)}${scale ? ` ${scale.unit}` : ""}`,
    tick: (value: number) => number.format(value / factor),
  };
}

export function formatQuantity(value: string): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 }).format(value as NumericString);
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(value / 100);
}

export function formatMonth(month: string, style: "short" | "long" = "short"): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, { month: style, year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
