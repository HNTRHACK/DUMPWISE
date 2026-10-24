// Display formatting with Intl. Values arrive as decimal strings; Intl.NumberFormat formats
// decimal strings exactly (no float rounding of large amounts).

const LOCALE = "en-IN"; // lakh/crore grouping for INR, standard symbols for other currencies

type NumericString = `${number}`;

export function formatMoney(value: string, currency: string, opts: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 2,
    minimumFractionDigits: opts.compact ? 0 : 2,
  }).format(value as NumericString);
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
