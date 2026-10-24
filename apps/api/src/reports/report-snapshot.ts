import { Decimal } from 'decimal.js';
import { growth } from '../analytics/analytics.service.js';

const Exact = Decimal.clone({ precision: 50 });
export const REPORT_DEFINITION_VERSION = 'dumpwise-management-v1';
export const METRIC_VERSION = 'published-sap-net-v1';
export interface ReportFact {
  id: string; date: string; document: string; item: string; type: string;
  sku: string; distributor: string; customer: string;
  amount: string; quantity: string; currency: string; unit: string;
  batchId: string; line: number; templateVersionId: string | null; rulesVersion: string;
}
export interface ReportSource {
  id: string; fileName: string; sha256: string; publishedAt: string;
  accepted: number; rejected: number; duplicates: number; inserted: number;
  templateVersionId: string | null; rulesVersion: string;
  checks: { metric: string; month: string; currency: string | null; unit: string | null;
    expected: string; actual: string; passed: boolean }[];
}
export interface ReportGroup {
  code: string; unit: string; netRevenue: string; quantity: string; lines: number;
  credits: string; returns: string; cancellations: string;
  previousRevenue: string; growthPercent: string | null; growthReason: string | null;
}
export interface ReportSnapshotData {
  definitionVersion: string; metricVersion: string; generatedAt: string;
  organizationId: string; organizationName: string; classification: string;
  from: string; to: string; currency: string; unit: string | null;
  previousFrom: string; previousTo: string;
  netRevenue: string; credits: string; returns: string; cancellations: string; transactionCount: number;
  units: { unit: string; quantity: string }[];
  months: { month: string; netRevenue: string; lines: number }[];
  products: ReportGroup[]; distributors: ReportGroup[]; customers: ReportGroup[];
  transactions: ReportFact[]; sources: ReportSource[];
  sourceFileStatus: 'NOT_RETAINED'; coverageNote: string;
}

export function summarizeSnapshot(input: Omit<ReportSnapshotData,
  'definitionVersion' | 'metricVersion' | 'netRevenue' | 'credits' | 'returns' | 'cancellations' | 'transactionCount' |
  'units' | 'months' | 'products' | 'distributors' | 'customers' | 'sourceFileStatus' | 'coverageNote'>,
  allFacts: ReportFact[], monthsInPeriod: number): ReportSnapshotData {
  const current = allFacts.filter(f => f.date.slice(0, 7) >= input.from);
  const sum = (rows: ReportFact[], field: 'amount' | 'quantity') => rows.reduce((s, f) => s.plus(f[field]), new Exact(0));
  const reduction = (rows: ReportFact[], type: string) => sum(rows.filter(f => f.type === type), 'amount').negated().toFixed(2);
  const group = (field: 'sku' | 'distributor' | 'customer') => {
    const keys = new Map<string, { code: string; unit: string }>();
    const grouped = new Map<string, ReportFact[]>();
    for (const f of allFacts) {
      const key = JSON.stringify([f[field], f.unit]);
      const bucket = grouped.get(key);
      if (bucket) bucket.push(f); else grouped.set(key, [f]);
    }
    for (const f of current) keys.set(JSON.stringify([f[field], f.unit]), { code: f[field], unit: f.unit });
    const rows: ReportGroup[] = [];
    for (const { code, unit } of keys.values()) {
      const own = grouped.get(JSON.stringify([code, unit]))!;
      const now = own.filter(f => f.date.slice(0, 7) >= input.from), prior = own.filter(f => f.date.slice(0, 7) < input.from);
      const net = sum(now, 'amount').toFixed(2), previous = sum(prior, 'amount').toFixed(2);
      rows.push({ code, unit, netRevenue: net, quantity: sum(now, 'quantity').toFixed(3), lines: now.length,
        credits: reduction(now, 'G2'), returns: reduction(now, 'RE'), cancellations: reduction(now, 'S1'), previousRevenue: previous,
        ...growth(net, previous, new Set(now.map(f => f.date.slice(0, 7))).size,
          new Set(prior.map(f => f.date.slice(0, 7))).size, monthsInPeriod) });
    }
    return rows.sort((a, b) => new Exact(b.netRevenue).comparedTo(a.netRevenue) || a.code.localeCompare(b.code) || a.unit.localeCompare(b.unit));
  };
  const unitCodes = [...new Set(current.map(f => f.unit))].sort();
  const monthCodes = [...new Set(current.map(f => f.date.slice(0, 7)))].sort();
  return { ...input, transactions: current, definitionVersion: REPORT_DEFINITION_VERSION, metricVersion: METRIC_VERSION,
    netRevenue: sum(current, 'amount').toFixed(2), credits: reduction(current, 'G2'), returns: reduction(current, 'RE'), cancellations: reduction(current, 'S1'),
    transactionCount: current.length, units: unitCodes.map(unit => ({ unit, quantity: sum(current.filter(f => f.unit === unit), 'quantity').toFixed(3) })),
    months: monthCodes.map(month => ({ month, netRevenue: sum(current.filter(f => f.date.startsWith(month)), 'amount').toFixed(2), lines: current.filter(f => f.date.startsWith(month)).length })),
    products: group('sku'), distributors: group('distributor'), customers: group('customer'),
    sourceFileStatus: 'NOT_RETAINED', coverageNote: 'Activity months only; missing activity is not proof of missing SAP extracts. Original files are not retained.',
  };
}
