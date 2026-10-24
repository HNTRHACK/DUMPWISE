"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api/client';
import { useResource } from '@/lib/use-resource';
import { useWorkspace } from './workspace-provider';
import { ErrorState, InlineError } from './states';
import { formatDateTime } from '@/lib/format';

export function PilotAssessment({ reportId }: { reportId: string }) {
  const { organization } = useWorkspace();
  const [manual, setManual] = useState(''); const [automated, setAutomated] = useState('');
  const [reviewed, setReviewed] = useState(false); const [description, setDescription] = useState('');
  const [status, setStatus] = useState('OPEN'); const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]); const [offset, setOffset] = useState(0);
  const history = useResource(`pilot|${organization.organizationId}|${reportId}|${offset}`, signal => api.pilotHistory(organization.organizationId, reportId, offset, signal));
  return <details className="mt-5 border-t border-border pt-4"><summary className="cursor-pointer font-medium">Pilot review and labor-time comparison</summary>
    <p className="my-3 text-xs text-muted">Enter measured whole-workflow labor minutes for the same task and scope. These are user statements, not automatic timings or financial savings. Submit a new assessment to resolve a discrepancy; earlier statements remain in history.</p>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault(); if (pending) return; setPending(true); setErrors([]);
      try { await api.assessPilot(organization.organizationId, reportId, { manualMinutes: manual, automatedMinutes: automated, reviewed,
        discrepancies: description.trim() ? [{ description, status }] : [] }); setOffset(0); history.reload(); }
      catch (err) { setErrors(err instanceof ApiError ? err.messages : ['Assessment could not be recorded']); }
      finally { setPending(false); }
    }}>
      <label className="text-sm">Baseline manual labor minutes<Input type="number" min="0" max="10080" step="0.01" required value={manual} onChange={e => setManual(e.target.value)} /></label>
      <label className="text-sm">DUMPWISE workflow labor minutes<Input type="number" min="0" max="10080" step="0.01" required value={automated} onChange={e => setAutomated(e.target.value)} /></label>
      <label className="text-sm">Discrepancy / resolution note (optional)<Input maxLength={200} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label className="text-sm">Discrepancy status<Select value={status} onChange={e => setStatus(e.target.value)}><option>OPEN</option><option>RESOLVED</option></Select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed both exports against the intended report</label>
      <Button type="submit" disabled={pending}>Record pilot assessment</Button>
    </form><InlineError messages={errors} />
    {history.state === 'error' ? <ErrorState error={history.error} onRetry={history.reload} /> : null}
    {history.data ? <>
      <p className="my-3 text-xs text-muted">Snapshot evidence: {history.data.reportEvidence.acceptedBatchRows} accepted / {history.data.reportEvidence.rejectedBatchRows} rejected rows across whole contributing batches, including comparison sources. {history.data.reportEvidence.checksPassed}/{history.data.reportEvidence.checksTotal} stored batch checks passed ({history.data.reportEvidence.reconciliationPassPercent ?? 'not available'}%). {history.data.reportEvidence.activityMonths} activity months. Two generated export formats.</p>
      <ul className="space-y-3 text-sm">{history.data.items.map(r => <li key={r.id} className="rounded-xl border border-border p-3">
        <p>{formatDateTime(r.createdAt)} · USER ENTERED · {r.reviewed ? 'Both exports reviewed' : 'Review unconfirmed'}</p>
        <p>Manual {r.manualMinutes} min; DUMPWISE {r.automatedMinutes} min; difference {r.laborMinutesDifference} labor min (a negative value means more time).</p>
        <ul>{r.discrepancies.map((d, i) => <li key={i}>{d.status}: {d.description}</li>)}</ul>
      </li>)}</ul>
      <nav className="mt-3 flex flex-wrap gap-2" aria-label="Pilot history pagination"><Button variant="secondary" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous assessments</Button><Button variant="secondary" disabled={history.data.items.length < 20} onClick={() => setOffset(offset + 20)}>Next assessments</Button></nav>
    </> : null}
  </details>;
}
