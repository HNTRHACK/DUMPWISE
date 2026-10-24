"use client";

import { useState } from "react";
import { MonthlyChart } from "@/components/charts/monthly-chart";
import { Card, CardBody, CardHeader, CardTitle, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { CurrencyTabs } from "./currency-tabs";
import { EmptyState, ErrorState } from "./states";
import { useMonthlySales } from "./use-monthly-sales";
import { useWorkspace } from "./workspace-provider";
import { TransactionDrilldown } from './transaction-drilldown';
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/use-resource";
import { formatInteger, formatMoney, formatMonth, formatQuantity } from "@/lib/format";
import { monthsBetween, seriesFor } from "@/lib/analytics/monthly";

type Dimension = "products" | "distributors" | "customers";
const titles = { products: "Products", distributors: "Distributors", customers: "Customers" };

export function AnalyticsPage({ dimension }: { dimension: Dimension }) {
  const { organization, range, preset, setPreset } = useWorkspace();
  const monthly = useMonthlySales();
  const units = [...new Set(monthly.rows.filter(r => r.currency === monthly.currency).flatMap(r => r.unitsSold.map(u => u.unit)))].sort();
  return <>
    <PageHeader title={titles[dimension]} description="Published, reconciled billing activity. Credits, returns and cancellations reduce net revenue. Currencies and quantities stay separate."
      actions={<>
        <label className="sr-only" htmlFor={`${dimension}-range`}>Range</label>
        <Select id={`${dimension}-range`} className="md:hidden" value={preset} onChange={e => setPreset(Number(e.target.value) as 3 | 6 | 12)}>
          {[3, 6, 12].map(n => <option key={n} value={n}>{n} completed months</option>)}
        </Select>
        <CurrencyTabs currencies={monthly.currencies} value={monthly.currency} onChange={monthly.setCurrency} />
      </>} />
    {monthly.resource.state === "error" ? <ErrorState error={monthly.resource.error} onRetry={monthly.resource.reload} /> : monthly.resource.state === "loading" ? <Skeleton className="h-64" /> : !monthly.currency ?
      <EmptyState title="No published analytics">Try a longer range or publish a reconciled import.</EmptyState> :
      <Report key={`${organization.organizationId}|${range.from}|${range.to}|${monthly.currency}|${dimension}`} dimension={dimension} currency={monthly.currency} units={units} />}
  </>;
}

function Report({ dimension, currency, units }: { dimension: Dimension; currency: string; units: string[] }) {
  const { organization, range } = useWorkspace();
  const [unit, setUnit] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("netRevenue");
  const [direction, setDirection] = useState("desc");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<{ id: string; code: string } | null>(null);
  const query = { ...range, currency, ...(unit ? { unit } : {}), search, sort, direction, limit: "20", offset: String(offset) };
  const resource = useResource(JSON.stringify([organization.organizationId, dimension, query]), signal => api.analytics(organization.organizationId, dimension, query, signal));
  const filters = <div className="mb-5 flex flex-wrap items-end gap-3">
    <label className="text-xs text-muted">Search code or name<input aria-label="Search code or name" maxLength={100} value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} className="mt-1 block rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text" /></label>
    <label className="text-xs text-muted">Unit<Select aria-label="Unit" value={unit} onChange={e => { setUnit(e.target.value); setOffset(0); if (!e.target.value && sort === "netQuantity") setSort("netRevenue"); }}><option value="">All units (kept separate)</option>{units.map(u => <option key={u}>{u}</option>)}</Select></label>
    <label className="text-xs text-muted">Sort by<Select aria-label="Sort by" value={sort} onChange={e => { setSort(e.target.value); setOffset(0); }}><option value="netRevenue">Net revenue</option><option value="transactionCount">Line items</option><option value="code">Code</option>{unit && <option value="netQuantity">Net quantity</option>}</Select></label>
    <label className="text-xs text-muted">Order<Select aria-label="Order" value={direction} onChange={e => { setDirection(e.target.value); setOffset(0); }}><option value="desc">Descending</option><option value="asc">Ascending</option></Select></label>
  </div>;
  const data = resource.data;
  return <>{filters}
    {resource.state === "error" ? <ErrorState error={resource.error} onRetry={resource.reload} /> : resource.state === "loading" || !data ? <Skeleton className="h-96" /> : <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[['Net revenue', formatMoney(data.summary.netRevenue, currency)], ['Credited amount', formatMoney(data.summary.creditedAmount, currency)], ['Returned amount', formatMoney(data.summary.returnedAmount, currency)], ['Cancelled amount', formatMoney(data.summary.cancelledAmount, currency)]].map(([label, value]) =>
          <Card key={label} className="min-w-0 p-5"><p className="text-xs text-muted">{label}</p><p className="tabular mt-2 break-words font-display text-xl">{value}</p></Card>)}
      </div>
      <p className="text-sm text-muted">{formatInteger(data.summary.transactionCount)} billing line items · {data.summary.units.map(u => `${formatQuantity(u.quantity)} ${u.unit}`).join(" · ") || "No quantities"}. Totals cover all filtered rows, not just this page.</p>
      <TransactionDrilldown currency={currency} filters={{ dimension, search, ...(unit ? { unit } : {}) }} />
      <Card><CardHeader><CardTitle>Ranked {dimension} · {currency}</CardTitle></CardHeader><CardBody>
        <p className="my-3 text-xs text-muted">One row per entity and unit. Growth compares {formatMonth(data.from)}–{formatMonth(data.to)} with {formatMonth(data.previousFrom)}–{formatMonth(data.previousTo)}; every month needs activity and prior net revenue must be positive.</p>
        {!data.items.length ? <EmptyState title="No matching billing activity">Adjust the unit, range or search.</EmptyState> : <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm tabular">
          <caption className="sr-only">{titles[dimension]} analytics in {currency}</caption><thead><tr className="border-b border-border text-left text-xs text-muted">
            {['Rank', 'Code / name', 'Unit', 'Net revenue', 'Credits', 'Returns', 'Cancellations', 'Net quantity', 'Line items', 'Growth'].map(h => <th scope="col" className="p-3" key={h}>{h}</th>)}
          </tr></thead><tbody>{data.items.map((r, i) => <tr className="border-b border-border" key={`${r.id}|${r.unit}`}>
            <td className="p-3">{offset + i + 1}</td><th scope="row" className="p-3 text-left font-medium">{dimension === 'products' ? <button className="text-accent-text underline" onClick={() => setSelected({ id: r.id, code: r.code })}>{r.code}</button> : <button className="text-accent-text underline" onClick={() => setSelected({ id: r.id, code: r.code })}>{r.code}</button>}<span className="block text-xs font-normal text-muted">{r.name ?? 'No description'}</span></th>
            <td className="p-3">{r.unit}</td>{[r.netRevenue, r.creditedAmount, r.returnedAmount, r.cancelledAmount].map((v, j) => <td key={j} className="p-3 whitespace-nowrap">{formatMoney(v, currency)}</td>)}
            <td className="p-3">{formatQuantity(r.netQuantity)}</td><td className="p-3">{formatInteger(r.transactionCount)}</td><td className="p-3">{r.growthPercent === null ? r.growthReason : `${r.growthPercent}%`}</td>
          </tr>)}</tbody></table></div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted"><span>{data.total} entity/unit rows · {data.items.length ? offset + 1 : 0}–{data.items.length ? offset + data.items.length : 0}</span><div className="flex gap-2"><Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button><Button variant="secondary" disabled={offset + 20 >= data.total} onClick={() => setOffset(offset + 20)}>Next</Button></div></div>
      </CardBody></Card>
      {selected && dimension !== 'products' ? <TransactionDrilldown currency={currency} filters={{ [dimension === 'distributors' ? 'distributorId' : 'customerId']: selected.id, ...(unit ? { unit } : {}) }} label={`Trace source lines for ${selected.code}`} /> : null}
      {dimension === 'products' && (selected ? <ProductTrend key={`${selected.id}|${unit}`} id={selected.id} code={selected.code} currency={currency} unit={unit} /> : <p className="text-sm text-muted">Select a product code to explore its monthly trend and exact values.</p>)}
    </div>}
  </>;
}

function ProductTrend({ id, code, currency, unit }: { id: string; code: string; currency: string; unit: string }) {
  const { organization, range } = useWorkspace();
  const query = { ...range, currency, ...(unit ? { unit } : {}) };
  const resource = useResource(JSON.stringify([organization.organizationId, id, query]), signal => api.productTrend(organization.organizationId, id, query, signal));
  if (resource.state === "error") return <ErrorState error={resource.error} onRetry={resource.reload} />;
  if (resource.state === "loading" || !resource.data) return <Skeleton className="h-64" />;
  const series = seriesFor(resource.data.months, currency, monthsBetween(range.from, range.to));
  return <Card><CardHeader><CardTitle>Product trend · {code}</CardTitle></CardHeader><CardBody>
    <TransactionDrilldown currency={currency} filters={{ productId: id, ...(unit ? { unit } : {}) }} label={`Trace source lines for ${code}`} />
    <MonthlyChart currency={currency} series={series} />
    <div className="overflow-x-auto"><table className="w-full text-sm tabular"><caption className="sr-only">Exact monthly product trend for {code}</caption><thead><tr>{['Month', 'Net revenue', 'Line items', 'Net quantities'].map(h => <th className="p-3 text-left" scope="col" key={h}>{h}</th>)}</tr></thead><tbody>
      {series.map(p => <tr key={p.month} className="border-t border-border"><th scope="row" className="p-3 text-left">{formatMonth(p.month)}</th><td className="p-3">{p.netSales === null ? 'No published data' : formatMoney(p.netSales, currency)}</td><td className="p-3">{p.transactionCount === null ? '—' : formatInteger(p.transactionCount)}</td><td className="p-3">{p.units.map(u => `${formatQuantity(u.quantity)} ${u.unit}`).join(' · ') || '—'}</td></tr>)}
    </tbody></table></div>
  </CardBody></Card>;
}
