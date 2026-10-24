"use client";

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api/client';
import { useResource } from '@/lib/use-resource';
import { formatMoney, formatQuantity } from '@/lib/format';
import { useWorkspace } from './workspace-provider';
import { EmptyState, ErrorState } from './states';

export function TransactionDrilldown({ currency, filters = {}, label = 'Trace contributing transactions' }:
  { currency: string; filters?: Record<string, string>; label?: string }) {
  const { organization, range } = useWorkspace();
  const [open, setOpen] = useState(false);
  if (organization.role === 'VIEWER') return <p className="text-xs text-muted">Source identifiers require an owner or analyst. Your summary access is unchanged.</p>;
  return <div className="my-4">
    <Button variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide source transactions' : label}</Button>
    {open ? <TransactionTable key={JSON.stringify([organization.organizationId, range, currency, filters])} currency={currency} filters={filters} /> : null}
  </div>;
}

function TransactionTable({ currency, filters }: { currency: string; filters: Record<string, string> }) {
  const { organization, range } = useWorkspace();
  const [offset, setOffset] = useState(0);
  const query = { ...range, currency, ...filters, limit: '20', offset: String(offset) };
  const resource = useResource(JSON.stringify([organization.organizationId, query]), signal => api.transactions(organization.organizationId, query, signal));
  if (resource.state === 'error') return <ErrorState error={resource.error} onRetry={resource.reload} />;
  if (resource.state === 'loading' || !resource.data) return <Skeleton className="mt-4 h-56" />;
  const data = resource.data;
  return <Card className="mt-4"><CardHeader><CardTitle>Source transaction lineage</CardTitle></CardHeader><CardBody>
    <p className="text-sm">Full filtered subset: {formatMoney(data.summary.netRevenue, currency)}; {data.total} line items; {data.summary.units.map(u => `${formatQuantity(u.quantity)} ${u.unit}`).join(' · ')}.</p>
    <p className="my-2 text-xs text-muted">Published and reconciled only. Document IDs and source lines are retained; original CSV files are not stored. Batch reconciliation is separate evidence.</p>
    {!data.items.length ? <EmptyState title="No source lines">Check the period, currency and filters.</EmptyState> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm tabular">
      <caption className="sr-only">Exact contributing source transactions in {currency}</caption>
      <thead><tr>{['Date', 'Document / item', 'Type', 'SKU', 'Sold-to / ship-to', 'Net amount', 'Net quantity', 'Batch / source line', 'Mapping evidence'].map(h => <th scope="col" className="p-2" key={h}>{h}</th>)}</tr></thead>
      <tbody>{data.items.map(t => <tr key={t.id} className="border-t border-border">
        <td className="p-2">{t.billingDate}</td><th scope="row" className="p-2 font-normal">{t.billingDocument} / {t.billingItem}</th>
        <td className="p-2">{t.billingType}</td><td className="p-2">{t.sku}</td><td className="p-2">{t.distributorCode} / {t.customerCode}</td>
        <td className="p-2 whitespace-nowrap">{formatMoney(t.netAmount, currency)}</td><td className="p-2">{formatQuantity(t.quantity)} {t.unit}</td>
        <td className="p-2"><Link className="text-accent-text underline" href={`/app/imports/${t.batchId}`}>{t.fileName}</Link><p>Line {t.sourceRowNumber}</p></td>
        <td className="p-2 text-xs">{t.templateVersionId ?? 'Legacy SAP aliases'}<p>{t.rulesVersion}</p><details><summary>Source checksum</summary>{t.fileSha256}</details></td>
      </tr>)}</tbody></table></div>}
    <nav aria-label="Transaction pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted">{data.items.length ? offset + 1 : 0}–{data.items.length ? offset + data.items.length : 0} of {data.total}</span>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous source page</Button><Button variant="secondary" disabled={offset + 20 >= data.total} onClick={() => setOffset(offset + 20)}>Next source page</Button></div>
    </nav>
  </CardBody></Card>;
}
