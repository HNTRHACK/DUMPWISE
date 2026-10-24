"use client";

import { useState } from 'react';
import { useWorkspace } from '@/components/dashboard/workspace-provider';
import { useMonthlySales } from '@/components/dashboard/use-monthly-sales';
import { CurrencyTabs } from '@/components/dashboard/currency-tabs';
import { EmptyState, ErrorState, InlineError } from '@/components/dashboard/states';
import { Card, CardBody, CardHeader, CardTitle, PageHeader, Select, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api/client';
import { useResource } from '@/lib/use-resource';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { PilotAssessment } from '@/components/dashboard/pilot-assessment';

export default function ReportsPage() {
  const { organization } = useWorkspace();
  if (organization.role === 'VIEWER') return <><PageHeader title="Report center" /><EmptyState title="Source report permission required">Owners and analysts can generate and download reports containing source identifiers. You can continue viewing the summary dashboards.</EmptyState></>;
  return <ReportBuilder key={organization.organizationId} />;
}

function ReportBuilder() {
  const { organization, range, preset, setPreset } = useWorkspace();
  const monthly = useMonthlySales();
  const org = organization.organizationId;
  const [unit, setUnit] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [retry, setRetry] = useState<{ signature: string; key: string } | null>(null);
  const list = useResource(`reports|${org}|${offset}`, signal => api.reports(org, offset, signal));
  const units = [...new Set(monthly.rows.filter(r => r.currency === monthly.currency).flatMap(r => r.unitsSold.map(u => u.unit)))].sort();
  async function generate() {
    if (pending || !monthly.currency) return;
    setPending(true); setErrors([]);
    const config = { ...range, currency: monthly.currency, ...(unit ? { unit } : {}) };
    const signature = JSON.stringify(config);
    const key = retry?.signature === signature ? retry.key : crypto.randomUUID();
    setRetry({ signature, key });
    try {
      const row = await api.createReport(org, { ...config, idempotencyKey: key });
      setSelected(row.id); setRetry(null); setOffset(0); list.reload();
    } catch (e) { setErrors(e instanceof ApiError ? e.messages : ['Report generation failed. Retry preserves the request key.']); }
    finally { setPending(false); }
  }
  return <>
    <PageHeader title="Report center" description="Generic DUMPWISE management reports. One reconciled snapshot powers the preview, editable Excel and PowerPoint."
      actions={<CurrencyTabs currencies={monthly.currencies} value={monthly.currency} onChange={c => { monthly.setCurrency(c); setUnit(''); }} />} />
    <Card><CardHeader><CardTitle>Build a reconciled report</CardTitle></CardHeader><CardBody>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Report range<Select aria-label="Report range" value={preset} disabled={pending} onChange={e => setPreset(Number(e.target.value) as 3 | 6 | 12)}>{[3, 6, 12].map(n => <option key={n} value={n}>{n} completed months</option>)}</Select></label>
        <label className="text-sm">Report unit<Select aria-label="Report unit" value={unit} disabled={pending} onChange={e => setUnit(e.target.value)}><option value="">All units, kept separate</option>{units.map(u => <option key={u}>{u}</option>)}</Select></label>
        <Button disabled={pending || !monthly.currency || monthly.resource.state !== 'ready'} onClick={generate}>{pending ? 'Generating both formats…' : retry ? 'Retry report generation' : 'Generate Excel and PowerPoint'}</Button>
      </div>
      <p className="mt-3 text-xs text-muted">{range.from} through {range.to}. Published/PASSED facts only. Maximum 5,000 lines including the comparison period; downloads expire after seven days. Financial values remain exact editable text. Company-specific template matching requires an approved example.</p>
      <InlineError messages={errors} />
      {monthly.resource.state === 'error' ? <ErrorState error={monthly.resource.error} onRetry={monthly.resource.reload} /> : null}
    </CardBody></Card>
    <Card className="my-6"><CardHeader><CardTitle>Available private reports</CardTitle></CardHeader><CardBody>
      {list.state === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : list.state === 'loading' ? <Skeleton className="h-24" /> : !list.data?.items.length ? <EmptyState title="No available reports">Generate a snapshot to begin, or return to the first page.</EmptyState> : <ul className="space-y-2">{list.data.items.map(r => <li key={r.id}><button className="text-left text-sm text-accent-text underline" onClick={() => setSelected(r.id)}>{r.configuration.from}–{r.configuration.to} {r.configuration.currency} {r.configuration.unit ?? 'separate units'} · generated {formatDateTime(r.createdAt)}</button></li>)}</ul>}
      <nav className="mt-4 flex gap-2" aria-label="Report pagination"><Button variant="secondary" disabled={!offset || list.state === 'loading'} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous reports</Button><Button variant="secondary" disabled={list.state === 'loading' || (list.data?.items.length ?? 0) < 20} onClick={() => setOffset(offset + 20)}>Next reports</Button></nav>
    </CardBody></Card>
    {selected ? <ReportPreview key={selected} id={selected} /> : null}
  </>;
}

function ReportPreview({ id }: { id: string }) {
  const { organization } = useWorkspace();
  const resource = useResource(`report|${organization.organizationId}|${id}`, signal => api.report(organization.organizationId, id, signal));
  const [errors, setErrors] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  if (resource.state === 'error') return <ErrorState error={resource.error} onRetry={resource.reload} />;
  if (resource.state === 'loading' || !resource.data) return <Skeleton className="h-64" />;
  const { snapshot: s, expiresAt } = resource.data;
  const checks = s.sources.flatMap(b => b.checks);
  async function download(format: 'xlsx' | 'pptx') {
    setDownloading(true); setErrors([]);
    try { await api.downloadReport(organization.organizationId, id, format); }
    catch (e) { setErrors(e instanceof ApiError ? e.messages : ['Download unavailable']); }
    finally { setDownloading(false); }
  }
  return <Card><CardHeader><CardTitle>Reconciled snapshot preview</CardTitle><div className="flex flex-wrap gap-2"><Button disabled={downloading} onClick={() => download('xlsx')}>Download Excel</Button><Button variant="secondary" disabled={downloading} onClick={() => download('pptx')}>Download PowerPoint</Button></div></CardHeader><CardBody>
    <p className="text-sm">{s.organizationName} · {s.classification} · {s.from}–{s.to} · {s.currency}</p>
    <p className="tabular mt-3 text-2xl">{formatMoney(s.netRevenue, s.currency)}</p><p className="text-xs text-muted">Net revenue includes credits, returns and cancellations. {s.transactionCount} billing line items.</p>
    <p className="my-2 text-sm">{s.units.map(u => `${formatQuantity(u.quantity)} ${u.unit}`).join(' · ') || 'No quantities'}</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular"><caption className="sr-only">Exact report snapshot monthly trend</caption><thead><tr><th scope="col">Month</th><th scope="col">Net revenue</th><th scope="col">Line items</th></tr></thead><tbody>{s.months.map(m => <tr key={m.month} className="border-t border-border"><th scope="row" className="py-2 font-normal">{m.month}</th><td>{formatMoney(m.netRevenue, s.currency)}</td><td>{m.lines}</td></tr>)}</tbody></table></div>
    {!s.months.length ? <EmptyState title="No published activity">The files explain the empty period and contain no estimates.</EmptyState> : null}
    <p className="mt-4 text-sm">{s.sources.length} source batches; {checks.filter(c => c.passed).length}/{checks.length} stored batch checks passed. Latest contributing publication: {s.sources.length ? formatDateTime(s.sources.map(b => b.publishedAt).sort().at(-1)!) : 'None'}.</p>
    <p className="mt-2 text-xs text-muted">{s.coverageNote} Generated {formatDateTime(s.generatedAt)}. Download access until {formatDateTime(expiresAt)}. {s.definitionVersion} / {s.metricVersion}. This is a data preview; the PowerPoint contains editable tables rather than screenshots.</p>
    <InlineError messages={errors} />
    <PilotAssessment reportId={id} />
  </CardBody></Card>;
}
