"use client";

import { MonthlyChart } from "@/components/charts/monthly-chart";
import { CurrencyTabs } from "@/components/dashboard/currency-tabs";
import { EmptyState, ErrorState } from "@/components/dashboard/states";
import { useMonthlySales } from "@/components/dashboard/use-monthly-sales";
import { useWorkspace } from "@/components/dashboard/workspace-provider";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { formatInteger, formatMoney, formatMonth, formatQuantity } from "@/lib/format";

export default function SalesPage() {
  const { preset, setPreset } = useWorkspace();
  const { resource, currencies, currency, setCurrency, series, summary, range } = useMonthlySales();

  return (
    <>
      <PageHeader
        title="Sales"
        description="Monthly net sales from published imports (GET /v1/sales/monthly). One currency at a time; no conversion."
        actions={
          <>
            {/* Small screens only: the top bar's range picker is hidden below md, so exactly one
                range control is ever visible (no duplicate "Range" controls for screen readers). */}
            <label className="sr-only" htmlFor="sales-range">Range</label>
            <Select id="sales-range" value={preset} onChange={(e) => setPreset(Number(e.target.value) as 3 | 6 | 12)} className="h-9 w-auto md:hidden">
              <option value={3}>3 completed months</option>
              <option value={6}>6 completed months</option>
              <option value={12}>12 completed months</option>
            </Select>
            <CurrencyTabs currencies={currencies} value={currency} onChange={setCurrency} />
          </>
        }
      />

      {resource.state === "error" && !resource.data ? (
        <ErrorState error={resource.error} onRetry={resource.reload} />
      ) : !resource.data ? (
        <Skeleton className="h-96" />
      ) : !currency || !summary ? (
        <EmptyState title="No published sales in this range">Try a longer range, or publish a reconciled import first.</EmptyState>
      ) : (
        <div className="space-y-6" aria-busy={resource.state === "loading"}>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Net sales · {currency}</CardTitle>
                <p className="mt-1 text-xs text-muted">{formatMonth(range.from, "long")} – {formatMonth(range.to, "long")}</p>
              </div>
              {resource.data.dataClassification === "SYNTHETIC" ? <Badge tone="accent">Synthetic dataset</Badge> : null}
            </CardHeader>
            <CardBody><MonthlyChart series={series} currency={currency} height={340} /></CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Monthly detail · {currency}</CardTitle></CardHeader>
            <CardBody className="overflow-x-auto px-0">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Monthly net sales, line items and net units in {currency}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                    <th scope="col" className="px-5 py-2.5 font-medium">Month</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Net sales</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Line items</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Net units (per unit of measure)</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {series.map((p) => (
                    <tr key={p.month} className="border-b border-border/70 last:border-0">
                      <th scope="row" className="px-5 py-2.5 text-left font-medium text-text">{formatMonth(p.month, "long")}</th>
                      {p.netSales === null ? (
                        <td colSpan={3} className="px-5 py-2.5 text-muted">No published data</td>
                      ) : (
                        <>
                          <td className={`px-5 py-2.5 text-right ${p.netSales.startsWith("-") ? "text-danger" : "text-text"}`}>{formatMoney(p.netSales, currency)}</td>
                          <td className="px-5 py-2.5 text-right">{formatInteger(p.transactionCount ?? 0)}</td>
                          <td className="px-5 py-2.5 text-muted">{p.units.map((u) => `${formatQuantity(u.quantity)} ${u.unit}`).join(" · ")}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="tabular">
                  <tr className="border-t-2 border-border font-semibold">
                    <th scope="row" className="px-5 py-3 text-left">Total ({summary.monthsWithData} months with data)</th>
                    <td className="px-5 py-3 text-right">{formatMoney(summary.netSales, currency)}</td>
                    <td className="px-5 py-3 text-right">{formatInteger(summary.transactionCount)}</td>
                    <td className="px-5 py-3 font-normal text-muted">{summary.units.map((u) => `${formatQuantity(u.quantity)} ${u.unit}`).join(" · ")}</td>
                  </tr>
                </tfoot>
              </table>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
