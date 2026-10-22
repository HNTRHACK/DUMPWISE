import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { OrganizationAccess } from '../auth/organization-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { MonthlySalesQueryDto, MonthlySalesResponseDto, MonthlySalesRowDto } from './sales.dto.js';

const MAX_MONTHS = 36;

function monthIndex(m: string): number {
  const [y, mo] = m.split('-').map(Number);
  return y * 12 + (mo - 1);
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Monthly net sales from PUBLISHED batches only, for the caller's organization only.
   * The organization id comes from the verified access object, never from user input.
   */
  async monthly(access: OrganizationAccess, query: MonthlySalesQueryDto): Promise<MonthlySalesResponseDto> {
    const from = query.from ?? '2000-01';
    const to = query.to ?? '2100-12';
    if (monthIndex(from) > monthIndex(to)) throw new BadRequestException('from must not be after to');
    if (query.from && query.to && monthIndex(to) - monthIndex(from) + 1 > MAX_MONTHS) {
      throw new BadRequestException(`Range may cover at most ${MAX_MONTHS} months`);
    }
    const fromDate = new Date(`${from}-01T00:00:00.000Z`);
    const toIdx = monthIndex(to) + 1;
    const toExclusive = new Date(Date.UTC(Math.floor(toIdx / 12), toIdx % 12, 1));

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: access.organizationId },
      select: { dataClassification: true },
    });

    const rows = await this.prisma.$queryRaw<
      { month: string; currency: string; unit: string; net: string; lines: number; qty: string }[]
    >`
      SELECT to_char(t.billing_date, 'YYYY-MM') AS month,
             t.currency,
             t.sales_unit AS unit,
             SUM(t.net_amount)::text AS net,
             COUNT(*)::int AS lines,
             SUM(t.quantity)::text AS qty
      FROM sales_transactions t
      JOIN import_batches b
        ON b.organization_id = t.organization_id AND b.id = t.import_batch_id
      WHERE t.organization_id = ${access.organizationId}::uuid
        AND b.status = 'PUBLISHED'
        AND t.billing_date >= ${fromDate}::date
        AND t.billing_date < ${toExclusive}::date
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3`;

    const grouped = new Map<string, { row: MonthlySalesRowDto; net: Decimal }>();
    for (const r of rows) {
      const key = `${r.month}|${r.currency}`;
      let g = grouped.get(key);
      if (!g) {
        g = {
          net: new Decimal(0),
          row: { month: r.month, currency: r.currency, totalNetSales: '0.00', transactionCount: 0, unitsSold: [] },
        };
        grouped.set(key, g);
      }
      g.net = g.net.plus(r.net);
      g.row.transactionCount += r.lines;
      g.row.unitsSold.push({ unit: r.unit, quantity: new Decimal(r.qty).toFixed(3) });
    }

    return {
      organizationId: access.organizationId,
      dataClassification: org.dataClassification,
      months: [...grouped.values()].map((g) => ({ ...g.row, totalNetSales: g.net.toFixed(2) })),
    };
  }
}
