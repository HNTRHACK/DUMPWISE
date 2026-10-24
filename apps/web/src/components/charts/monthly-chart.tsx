"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthPoint } from "@/lib/analytics/monthly";
import { formatInteger, formatMoney, formatMonth } from "@/lib/format";

/**
 * Monthly net sales for ONE currency. Months without published data are gaps (null), not
 * zero bars. Recharts' accessibility layer makes the bars keyboard-focusable; the same numbers
 * are also available as a table on the Sales page.
 */
export function MonthlyChart({ series, currency, height = 300 }: { series: MonthPoint[]; currency: string; height?: number }) {
  const data = series.map((p) => ({
    month: p.month,
    label: formatMonth(p.month),
    // Number() only for drawing bar heights; every displayed value is formatted from the string.
    value: p.netSales === null ? null : Number(p.netSales),
    raw: p.netSales,
    count: p.transactionCount,
  }));
  const withData = series.filter((p) => p.netSales !== null);
  const summary = withData.length
    ? `Monthly net sales in ${currency} from ${formatMonth(series[0].month)} to ${formatMonth(series[series.length - 1].month)}; ${withData.length} of ${series.length} months have published data.`
    : `No published ${currency} sales in this range.`;

  return (
    <figure aria-label={summary} className="w-full">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 12 }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              tickFormatter={(v: number) => formatMoney(String(v), currency, { compact: true })}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                const d = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!d) return null;
                return (
                  <div className="rounded-xl border border-border bg-surface px-3 py-2 text-sm shadow-lg">
                    <p className="font-medium text-text">{formatMonth(d.month, "long")}</p>
                    {d.raw === null ? (
                      <p className="text-muted">No published data</p>
                    ) : (
                      <>
                        <p className="tabular text-text">{formatMoney(d.raw, currency)}</p>
                        <p className="tabular text-xs text-muted">{formatInteger(d.count ?? 0)} line items</p>
                      </>
                    )}
                  </div>
                );
              }}
            />
            <Bar dataKey="value" fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
