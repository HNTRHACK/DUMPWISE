"use client";

import { ArrowDownRight, ArrowUpRight, ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { MonthlyChart } from "@/components/charts/monthly-chart";
import { TransactionDrilldown } from '@/components/dashboard/transaction-drilldown';
import { CurrencyTabs } from "@/components/dashboard/currency-tabs";
import { ImportStatusBadge } from "@/components/dashboard/import-status";
import { EmptyState, ErrorState } from "@/components/dashboard/states";
import { useMonthlySales } from "@/components/dashboard/use-monthly-sales";
import { useWorkspace } from "@/components/dashboard/workspace-provider";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle, PageHeader, Skeleton } from "@/components/ui/primitives";
import { monthOverMonth } from "@/lib/analytics/monthly";
import { api } from "@/lib/api/client";
import { formatDateTime, formatInteger, formatMoney, formatMoneyScaled, formatMonth, formatPercent, formatQuantity } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

function Kpi({ label, value, hint, children }: { label: string; value: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="tabular mt-3 font-display text-3xl tracking-tight text-text">{value}</p>
      {hint ? <div className="mt-2 text-xs text-muted">{hint}</div> : null}
      {children}
    </Card>
  );
}

export default function OverviewPage() {
  const { organization, preset } = useWorkspace();
  const { resource, currencies, currency, setCurrency, series, summary, range } = useMonthlySales();
  const growth = monthOverMonth(series);
  const orgId = organization.organizationId;
  const imports = useResource(`imports|${orgId}`, (signal) => api.listImports(orgId, { limit: 5, offset: 0 }, signal));

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>Published, reconciled sales for <strong className="font-medium text-text">{organization.organizationName}</strong> · last {preset} completed months ({formatMonth(range.from)} – {formatMonth(range.to)}).</>
        }
        actions={<CurrencyTabs currencies={currencies} value={currency} onChange={setCurrency} />}
      />

      {resource.state === "error" && !resource.data ? (
        <ErrorState error={resource.error} onRetry={resource.reload} />
      ) : resource.state === "loading" && !resource.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : !currency || !summary ? (
        <EmptyState
          title="No published sales in this range"
          action={<Link href="/app/imports" className={buttonVariants({ variant: "secondary" })}>Go to imports <ArrowRight aria-hidden /></Link>}
        >
          Sales appear here after an import passes reconciliation and an owner publishes it. Try a longer range or check the import center.
        </EmptyState>
      ) : (
        <div aria-busy={resource.state === "loading"} className="space-y-6">
          <TransactionDrilldown currency={currency} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Kpi label={`Net sales · ${currency}`} value={formatMoneyScaled(summary.netSales, currency)} hint={<span className="tabular">{formatMoney(summary.netSales, currency)}</span>} />
            <Kpi
              label="Month over month"
              value={growth.kind === "value" ? (
                <span className={growth.percent >= 0 ? "text-success" : "text-danger"}>
                  {growth.percent >= 0 ? <ArrowUpRight className="mr-1 inline size-6" aria-hidden /> : <ArrowDownRight className="mr-1 inline size-6" aria-hidden />}
                  {formatPercent(growth.percent)}
                </span>
              ) : "—"}
              hint={growth.kind === "value" ? `${formatMonth(growth.month)} vs ${formatMonth(growth.previousMonth)}` : growth.reason}
            />
            <Kpi label="Line items" value={formatInteger(summary.transactionCount)} hint="Invoices, credit memos, returns and cancellations" />
            {/* Quantities in different units (KG, EA, CAR…) are never added together, so with several
                units the headline is the number of units of measure and the breakdown is the data. */}
            <Kpi
              label="Net units"
              value={summary.units.length === 1 ? `${formatQuantity(summary.units[0].quantity)} ${summary.units[0].unit}` : (
                <>{summary.units.length}{" "}<span className="block whitespace-nowrap font-sans text-sm font-medium tracking-normal">units of measure</span></>
              )}
              hint={summary.units.map((u) => `${formatQuantity(u.quantity)} ${u.unit}`).join(" · ") || "No units"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Monthly net sales · {currency}</CardTitle>
              <Link href="/app/sales" className={buttonVariants({ variant: "link", size: "sm" })}>Details <ArrowRight aria-hidden /></Link>
            </CardHeader>
            <CardBody><MonthlyChart series={series} currency={currency} /></CardBody>
          </Card>

          <div className="flex gap-3 rounded-2xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Coverage: {summary.monthsWithData} of {summary.monthsInRange} months have published {currency} data; months without data are gaps, not zero.
              {currencies.length > 1 ? ` ${currencies.filter((c) => c !== currency).join(", ")} is shown separately because no currency conversion is defined.` : ""}
              {" "}Units are totalled per unit of measure and never added across units.
            </p>
          </div>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Latest imports</CardTitle>
          <Link href="/app/imports" className={buttonVariants({ variant: "link", size: "sm" })}>Import center <ArrowRight aria-hidden /></Link>
        </CardHeader>
        <CardBody>
          {imports.state === "error" ? (
            <ErrorState error={imports.error} onRetry={imports.reload} />
          ) : !imports.data ? (
            <Skeleton className="h-24" />
          ) : imports.data.items.length === 0 ? (
            <p className="text-sm text-muted">No imports yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {imports.data.items.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <Link href={`/app/imports/${b.id}`} className="min-w-0 flex-1 truncate font-medium text-text hover:text-accent-text">{b.fileName}</Link>
                  <ImportStatusBadge status={b.status} />
                  <span className="tabular text-xs text-muted">{formatDateTime(b.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
