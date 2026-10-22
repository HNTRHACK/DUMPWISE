import { Decimal } from 'decimal.js';
import type { ControlTotals } from './parsing/control-totals.js';

export type ReconciliationMetric = 'NET_AMOUNT' | 'LINE_COUNT' | 'QUANTITY';

export interface ReconciliationCheck {
  metric: ReconciliationMetric;
  month: string;
  currency: string | null;
  unit: string | null;
  expected: string;
  actual: string;
  passed: boolean;
}

/** Aggregated from the database: one entry per (month, currency, sales unit). */
export interface ActualAggregateRow {
  month: string;
  currency: string;
  unit: string;
  net: string;
  lines: number;
  qty: string;
}

/**
 * Compares control totals with what is actually stored. Exact equality, no tolerance:
 * money totals are Decimal sums and must match to the paisa/cent. Any (month, currency)
 * or (month, unit) present on only one side is a failure (the other side counts as 0).
 */
export function reconcile(expected: ControlTotals, actual: ActualAggregateRow[]): ReconciliationCheck[] {
  const actualTotals = new Map<string, { net: Decimal; lines: number }>();
  const actualQty = new Map<string, Decimal>();
  for (const a of actual) {
    const tk = `${a.month}|${a.currency}`;
    const t = actualTotals.get(tk) ?? { net: new Decimal(0), lines: 0 };
    actualTotals.set(tk, { net: t.net.plus(a.net), lines: t.lines + a.lines });
    const qk = `${a.month}|${a.unit}`;
    actualQty.set(qk, (actualQty.get(qk) ?? new Decimal(0)).plus(a.qty));
  }

  const checks: ReconciliationCheck[] = [];
  const expectedTotals = new Map(expected.totals.map((t) => [`${t.month}|${t.currency}`, t]));
  for (const key of new Set([...expectedTotals.keys(), ...actualTotals.keys()])) {
    const [month, currency] = key.split('|');
    const e = expectedTotals.get(key);
    const a = actualTotals.get(key);
    const eNet = new Decimal(e?.netAmount ?? 0);
    const aNet = a?.net ?? new Decimal(0);
    checks.push({
      metric: 'NET_AMOUNT', month, currency, unit: null,
      expected: eNet.toFixed(2), actual: aNet.toFixed(2), passed: eNet.eq(aNet),
    });
    const eLines = e?.lineCount ?? 0;
    const aLines = a?.lines ?? 0;
    checks.push({
      metric: 'LINE_COUNT', month, currency, unit: null,
      expected: String(eLines), actual: String(aLines), passed: eLines === aLines,
    });
  }

  const expectedQty = new Map(expected.quantityTotals.map((q) => [`${q.month}|${q.unit}`, q]));
  for (const key of new Set([...expectedQty.keys(), ...actualQty.keys()])) {
    const [month, unit] = key.split('|');
    const eQ = new Decimal(expectedQty.get(key)?.quantity ?? 0);
    const aQ = actualQty.get(key) ?? new Decimal(0);
    checks.push({
      metric: 'QUANTITY', month, currency: null, unit,
      expected: eQ.toFixed(3), actual: aQ.toFixed(3), passed: eQ.eq(aQ),
    });
  }

  return checks.sort((x, y) =>
    `${x.month}${x.metric}${x.currency ?? x.unit}`.localeCompare(`${y.month}${y.metric}${y.currency ?? y.unit}`),
  );
}
