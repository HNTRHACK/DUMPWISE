import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { Prisma } from '../generated/prisma/client.js';
import { OrganizationAccessService, type OrganizationAccess } from '../auth/organization-access.service.js';
import { TenantDb } from '../prisma/tenant-db.service.js';
import type { AnalyticsRangeDto, AnalyticsQueryDto, AnalyticsResponseDto, AnalyticsRowDto, ProductTrendDto } from './analytics.dto.js';

const ExactDecimal = Decimal.clone({ precision: 50 });

export type Dimension = 'products' | 'distributors' | 'customers';
const dimensions = {
  products: { table: 'products', foreign: 'product_id', code: 'sku', name: 'description' },
  distributors: { table: 'distributors', foreign: 'distributor_id', code: 'code', name: 'name' },
  customers: { table: 'customers', foreign: 'customer_id', code: 'code', name: 'name' },
} as const;
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1;
const monthAt = (i: number) => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
export function periods(q: { from: string; to: string }) {
  const start = monthIndex(q.from), end = monthIndex(q.to), count = end - start + 1;
  if (!Number.isInteger(count) || count < 1 || count > 36) throw new BadRequestException('Range must cover 1 to 36 months');
  return { count, previousFrom: monthAt(start - count), previousTo: monthAt(start - 1),
    start: new Date(`${q.from}-01T00:00:00Z`), end: new Date(`${monthAt(end + 1)}-01T00:00:00Z`),
    previous: new Date(`${monthAt(start - count)}-01T00:00:00Z`) };
}
export function growth(current: string, previous: string, currentMonths: number, previousMonths: number, expected: number) {
  if (currentMonths !== expected || previousMonths !== expected) return { growthPercent: null, growthReason: 'Incomplete comparison coverage' };
  if (new ExactDecimal(previous).lte(0)) return { growthPercent: null, growthReason: 'Previous revenue is zero or negative' };
  return { growthPercent: new ExactDecimal(current).minus(previous).div(previous).times(100).toFixed(2), growthReason: null };
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly tenantDb: TenantDb, private readonly access: OrganizationAccessService) {}

  async list(access: OrganizationAccess, dimension: Dimension, q: AnalyticsQueryDto): Promise<AnalyticsResponseDto> {
    await this.access.require(access.userId, access.organizationId);
    const p = periods(q), d = dimensions[dimension];
    if (q.sort === 'netQuantity' && !q.unit) throw new BadRequestException('Quantity sorting requires one unit');
    const sort = { netRevenue: 'net', transactionCount: 'lines', code: 'code', netQuantity: 'qty' }[q.sort];
    if (!sort || !['asc', 'desc'].includes(q.direction)) throw new BadRequestException('Invalid sort');
    // Only code-owned identifiers enter Prisma.raw; every request value is a bound parameter.
    const table = Prisma.raw(d.table), fk = Prisma.raw(`t.${d.foreign}`);
    const code = Prisma.raw(`e.${d.code}`), name = Prisma.raw(`e.${d.name}`);
    const rows = await this.tenantDb.run(access, tx => tx.$queryRaw<{
      items: (AnalyticsRowDto & { currentMonths: number; previousMonths: number })[];
      summary: AnalyticsResponseDto['summary']; total: number;
    }[]>(Prisma.sql`
      WITH monthly AS (
        SELECT e.id, ${code} AS code, ${name} AS name, t.sales_unit AS unit,
          date_trunc('month', t.billing_date) AS month,
          SUM(t.net_amount) AS net, SUM(t.quantity) AS qty, COUNT(*)::int AS lines,
          -SUM(CASE WHEN t.billing_type = 'G2' THEN t.net_amount ELSE 0 END) AS credits,
          -SUM(CASE WHEN t.billing_type = 'RE' THEN t.net_amount ELSE 0 END) AS returns,
          -SUM(CASE WHEN t.billing_type = 'S1' THEN t.net_amount ELSE 0 END) AS cancellations
        FROM sales_transactions t
        JOIN import_batches b ON b.organization_id = t.organization_id AND b.id = t.import_batch_id
        JOIN ${table} e ON e.organization_id = t.organization_id AND e.id = ${fk}
        WHERE t.organization_id = ${access.organizationId}::uuid
          AND b.status = 'PUBLISHED' AND b.reconciliation_status = 'PASSED'
          AND t.currency = ${q.currency} AND t.billing_date >= ${p.previous}::date AND t.billing_date < ${p.end}::date
          AND (${q.unit ?? null}::text IS NULL OR t.sales_unit = ${q.unit ?? null})
          AND (position(lower(${q.search ?? ''}) in lower(${code})) > 0 OR position(lower(${q.search ?? ''}) in lower(COALESCE(${name}, ''))) > 0)
        GROUP BY e.id, ${code}, ${name}, t.sales_unit, date_trunc('month', t.billing_date)
      ), current AS (SELECT * FROM monthly WHERE month >= ${p.start}),
      ranked AS (
        SELECT id, code, name, unit,
          COALESCE(SUM(net) FILTER (WHERE month >= ${p.start}), 0) AS net,
          COALESCE(SUM(qty) FILTER (WHERE month >= ${p.start}), 0) AS qty,
          COALESCE(SUM(lines) FILTER (WHERE month >= ${p.start}), 0)::int AS lines,
          COALESCE(SUM(credits) FILTER (WHERE month >= ${p.start}), 0) AS credits,
          COALESCE(SUM(returns) FILTER (WHERE month >= ${p.start}), 0) AS returns,
          COALESCE(SUM(cancellations) FILTER (WHERE month >= ${p.start}), 0) AS cancellations,
          COALESCE(SUM(net) FILTER (WHERE month < ${p.start}), 0) AS previous,
          COUNT(*) FILTER (WHERE month >= ${p.start})::int AS cm,
          COUNT(*) FILTER (WHERE month < ${p.start})::int AS pm
        FROM monthly GROUP BY id, code, name, unit
        HAVING COUNT(*) FILTER (WHERE month >= ${p.start}) > 0
      ), page AS (
        SELECT * FROM ranked ORDER BY ${Prisma.raw(sort)} ${Prisma.raw(q.direction)}, id, unit LIMIT ${q.limit} OFFSET ${q.offset}
      )
      SELECT (SELECT COUNT(*)::int FROM ranked) AS total,
        COALESCE((SELECT json_agg(json_build_object('id', id, 'code', code, 'name', name, 'unit', unit,
          'netRevenue', net::text, 'netQuantity', qty::text, 'transactionCount', lines,
          'creditedAmount', credits::text, 'returnedAmount', returns::text, 'cancelledAmount', cancellations::text,
          'previousRevenue', previous::text, 'currentMonths', cm, 'previousMonths', pm)) FROM page), '[]') AS items,
        json_build_object('netRevenue', (SELECT COALESCE(SUM(net),0)::text FROM current),
          'creditedAmount', (SELECT COALESCE(SUM(credits),0)::text FROM current),
          'returnedAmount', (SELECT COALESCE(SUM(returns),0)::text FROM current),
          'cancelledAmount', (SELECT COALESCE(SUM(cancellations),0)::text FROM current),
          'transactionCount', (SELECT COALESCE(SUM(lines),0)::int FROM current),
          'units', COALESCE((SELECT json_agg(u) FROM (SELECT unit, SUM(qty)::text AS quantity FROM current GROUP BY unit ORDER BY unit) u), '[]')) AS summary
    `));
    const result = rows[0];
    const money = (v: string) => new ExactDecimal(v).toFixed(2);
    const summary = result.summary;
    return { organizationId: access.organizationId, currency: q.currency, from: q.from, to: q.to,
      previousFrom: p.previousFrom, previousTo: p.previousTo, total: result.total, limit: q.limit, offset: q.offset,
      summary: { ...summary, netRevenue: money(summary.netRevenue), creditedAmount: money(summary.creditedAmount), returnedAmount: money(summary.returnedAmount), cancelledAmount: money(summary.cancelledAmount),
        units: summary.units.map(u => ({ unit: u.unit, quantity: new ExactDecimal(u.quantity).toFixed(3) })) },
      items: result.items.map(({ currentMonths, previousMonths, ...r }) => ({ ...r, netRevenue: money(r.netRevenue), creditedAmount: money(r.creditedAmount), returnedAmount: money(r.returnedAmount), cancelledAmount: money(r.cancelledAmount), netQuantity: new ExactDecimal(r.netQuantity).toFixed(3), previousRevenue: money(r.previousRevenue), ...growth(r.netRevenue, r.previousRevenue, currentMonths, previousMonths, p.count) })) };
  }

  async trend(access: OrganizationAccess, id: string, q: AnalyticsRangeDto): Promise<ProductTrendDto> {
    await this.access.require(access.userId, access.organizationId);
    const p = periods(q);
    return this.tenantDb.run(access, async tx => {
      const product = await tx.product.findFirst({ where: { id, organizationId: access.organizationId } });
      if (!product) throw new NotFoundException('Product not found');
      const org = await tx.organization.findUniqueOrThrow({ where: { id: access.organizationId } });
      const rows = await tx.$queryRaw<{ month: string; unit: string; net: string; qty: string; lines: number }[]>`
        SELECT to_char(t.billing_date, 'YYYY-MM') AS month, t.sales_unit AS unit,
          SUM(t.net_amount)::text AS net, SUM(t.quantity)::text AS qty, COUNT(*)::int AS lines
        FROM sales_transactions t JOIN import_batches b ON b.organization_id=t.organization_id AND b.id=t.import_batch_id
        WHERE t.organization_id=${access.organizationId}::uuid AND t.product_id=${id}::uuid
          AND b.status='PUBLISHED' AND b.reconciliation_status='PASSED' AND t.currency=${q.currency}
          AND t.billing_date>=${p.start}::date AND t.billing_date<${p.end}::date
          AND (${q.unit ?? null}::text IS NULL OR t.sales_unit=${q.unit ?? null})
        GROUP BY 1,2 ORDER BY 1,2`;
      const months: ProductTrendDto['months'] = [];
      for (const r of rows) {
        let month = months.find(m => m.month === r.month);
        if (!month) { month = { month: r.month, currency: q.currency, totalNetSales: '0.00', transactionCount: 0, unitsSold: [] }; months.push(month); }
        month.totalNetSales = new ExactDecimal(month.totalNetSales).plus(r.net).toFixed(2);
        month.transactionCount += r.lines;
        month.unitsSold.push({ unit: r.unit, quantity: new ExactDecimal(r.qty).toFixed(3) });
      }
      return { productId: id, organizationId: access.organizationId, dataClassification: org.dataClassification, months };
    });
  }
}
