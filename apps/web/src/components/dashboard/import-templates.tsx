"use client";

import { useState } from 'react';
import { api, ApiError } from '@/lib/api/client';
import { useResource } from '@/lib/use-resource';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/primitives';
import { InlineError, ErrorState } from './states';
import { useWorkspace } from './workspace-provider';

const FIELDS = [
  ['billingDate', 'Billing date', 'Billing Date'], ['billingDocument', 'Document', 'Billing Document'],
  ['billingItem', 'Document item', 'Item'], ['billingType', 'Billing type', 'Billing Type'],
  ['distributorCode', 'Sold-to code', 'Sold-To Party'], ['customerCode', 'Ship-to code', 'Ship-To Party'],
  ['sku', 'Material / SKU', 'Material'], ['quantity', 'Billed quantity', 'Billed Quantity'],
  ['salesUnit', 'Sales unit', 'Sales Unit'], ['netAmount', 'Net value in document currency', 'Net Value'],
  ['currency', 'Document currency', 'Doc. Currency'], ['cancelledDocument', 'Cancellation reference (required for S1)', 'Cancelled Bill. Doc.'],
] as const;

export function ImportTemplates({ onChanged }: { onChanged: () => void }) {
  const { organization } = useWorkspace();
  const org = organization.organizationId;
  const list = useResource(`templates|${org}`, signal => api.templates(org, signal));
  const [name, setName] = useState('');
  const [version, setVersion] = useState(1);
  const [description, setDescription] = useState('');
  const [columns, setColumns] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([f, , h]) => [f, h])));
  const [dateFormat, setDateFormat] = useState('DD.MM.YYYY');
  const [numberFormat, setNumberFormat] = useState('PLAIN');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  async function act(fn: () => Promise<unknown>) {
    setPending(true); setErrors([]);
    try { await fn(); list.reload(); onChanged(); }
    catch (e) { setErrors(e instanceof ApiError ? e.messages : ['Template request failed']); }
    finally { setPending(false); }
  }
  return <details className="mb-6 rounded-2xl border border-border bg-surface p-5">
    <summary className="cursor-pointer font-medium">Import templates and explicit column mapping</summary>
    <p className="my-3 text-sm text-muted">An owner must approve each immutable version before import. Map net document-currency value explicitly. Fixed F2/G2/RE/S1 sign rules always apply.</p>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void act(() => api.createTemplate(org, {
      name, description, version, mapping: { columns: Object.entries(columns).filter(([, header]) => header.trim()).map(([field, header]) => ({ field, header })),
        dateFormat, numberFormat, documentTypes: { F2: 'F2', G2: 'G2', RE: 'RE', S1: 'S1' } },
    })); }}>
      <label className="text-sm">Template name<Input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="text-sm">Version<Input type="number" required min={1} max={1000000} value={version} onChange={e => setVersion(Number(e.target.value))} /></label>
      <label className="text-sm sm:col-span-2">Business interpretation / description<Input maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label className="text-sm">Date format<Select value={dateFormat} onChange={e => setDateFormat(e.target.value)}>{['DD.MM.YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'].map(f => <option key={f}>{f}</option>)}</Select></label>
      <label className="text-sm">Number format<Select value={numberFormat} onChange={e => setNumberFormat(e.target.value)}><option>PLAIN</option><option>EN_GROUPED</option></Select></label>
      {FIELDS.map(([field, label]) => <label key={field} className="text-sm">{label}: source header<Input required={field !== 'cancelledDocument'} maxLength={120} value={columns[field]} onChange={e => setColumns({ ...columns, [field]: e.target.value })} /></label>)}
      <Button disabled={pending} type="submit">Save draft version</Button>
    </form>
    <InlineError messages={errors} />
    {list.state === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
    <ul className="mt-4 space-y-3">{list.data?.items.map(t => <li key={t.id} className="rounded-xl border border-border p-3 text-sm">
      <p>{t.name} v{t.version} — {t.status}</p><p className="text-muted">{t.description}</p>
      <details><summary className="cursor-pointer text-accent-text">Review interpretation</summary>
        <p>Date: {t.mapping.dateFormat}; numbers: {t.mapping.numberFormat}; rules: {t.rulesVersion}</p>
        <ul>{t.mapping.columns.map(c => <li key={c.field}>{c.header} → {c.field}</li>)}</ul>
      </details>
      {organization.role === 'OWNER' && t.status === 'DRAFT' ? <Button variant="secondary" disabled={pending} onClick={() => { if (window.confirm('Approve this mapping and its financial interpretation? Changes require a new version.')) void act(() => api.approveTemplate(org, t.id)); }}>Approve reviewed version</Button> : null}
    </li>)}</ul>
    {list.data && !list.data.items.length ? <p className="mt-3 text-sm text-muted">No custom templates. Standard SAP aliases remain available.</p> : null}
  </details>;
}
