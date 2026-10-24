"use client";

import { ArrowDownUp, ArrowLeft, CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ImportStatusBadge } from "@/components/dashboard/import-status";
import { ErrorState, InlineError } from "@/components/dashboard/states";
import { useWorkspace } from "@/components/dashboard/workspace-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Badge, Card, CardBody, CardHeader, CardTitle, Input, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api/client";
import type { ImportBatchDetail, ImportIssue, ReconciliationCheck } from "@/lib/api/schemas";
import { formatBytes, formatDateTime, formatInteger, formatMonth } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

const ISSUE_PAGE = 25;

export default function ImportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { organization } = useWorkspace();
  const orgId = organization.organizationId;
  const batch = useResource(`batch|${orgId}|${id}`, (signal) => api.getImport(orgId, id, signal));

  return (
    <>
      <Link href="/app/imports" className={buttonVariants({ variant: "link", size: "sm" })}><ArrowLeft aria-hidden /> All imports</Link>
      {batch.state === "error" && !batch.data ? (
        <div className="mt-4"><ErrorState error={batch.error} onRetry={batch.reload} /></div>
      ) : !batch.data ? (
        <div className="mt-4 space-y-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
      ) : (
        <BatchView batch={batch.data} onChanged={batch.reload} />
      )}
    </>
  );
}

function BatchView({ batch, onChanged }: { batch: ImportBatchDetail; onChanged: () => void }) {
  const s = batch.stats;
  return (
    <div className="mt-4">
      <PageHeader
        title={batch.fileName}
        description={<span className="tabular">Batch {batch.id} · {formatBytes(batch.fileSizeBytes)} · uploaded {formatDateTime(batch.createdAt)}{batch.publishedAt ? ` · published ${formatDateTime(batch.publishedAt)}` : ""}</span>}
        actions={<><ImportStatusBadge status={batch.status} />{batch.isSynthetic ? <Badge tone="accent">Synthetic</Badge> : null}<PublishAction batch={batch} onPublished={onChanged} /></>}
      />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {([["Rows in file", s.rowsTotal], ["Valid", s.rowsValid], ["Invalid", s.rowsInvalid], ["Duplicates in file", s.rowsDuplicateInFile], ["Already imported", s.rowsAlreadyImported], ["Inserted", s.rowsInserted]] as const).map(([k, v]) => (
          <Card key={k} className="p-4">
            <p className="text-xs text-muted">{k}</p>
            <p className={`tabular mt-1 text-xl font-semibold ${k === "Invalid" && v > 0 ? "text-danger" : "text-text"}`}>{formatInteger(v)}</p>
          </Card>
        ))}
      </div>
      <ReconciliationTable checks={batch.reconciliation} status={batch.reconciliationStatus} />
      <IssuesTable issues={batch.issues} />
    </div>
  );
}

function PublishAction({ batch, onPublished }: { batch: ImportBatchDetail; onPublished: () => void }) {
  const { can, organization } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  if (batch.status !== "READY_TO_PUBLISH") return null;
  // UI convenience: the API independently enforces OWNER-only publication (403 otherwise).
  if (!can("publish")) return <span className="text-xs text-muted">Only an owner can publish (you are {organization.role.toLowerCase()}).</span>;

  async function publish() {
    if (pending) return;
    setPending(true);
    setErrors([]);
    try {
      await api.publishImport(organization.organizationId, batch.id);
      setOpen(false);
      onPublished();
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("unavailable", 0, ["Publish failed"]);
      setErrors(e.kind === "conflict" ? e.messages : e.kind === "forbidden" ? ["Only an owner of this organization can publish."] : e.messages);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <Button onClick={() => setOpen(true)}><Send aria-hidden /> Publish</Button>
      <DialogContent
        title="Publish this batch?"
        description={<>Its {formatInteger(batch.stats.rowsInserted)} reconciled rows become visible in sales reports for everyone in {organization.organizationName}. Publication is recorded in the audit log and cannot be undone from the workspace.</>}
      >
        <InlineError messages={errors} />
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose asChild><Button variant="secondary" disabled={pending}>Cancel</Button></DialogClose>
          <Button onClick={publish} disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}{pending ? "Publishing…" : "Publish batch"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const METRIC: Record<ReconciliationCheck["metric"], string> = { NET_AMOUNT: "Net amount", LINE_COUNT: "Line count", QUANTITY: "Quantity" };

function ReconciliationTable({ checks, status }: { checks: ReconciliationCheck[]; status: ImportBatchDetail["reconciliationStatus"] }) {
  const [onlyFailed, setOnlyFailed] = useState(status === "FAILED");
  const rows = onlyFailed ? checks.filter((c) => !c.passed) : checks;
  const failed = checks.filter((c) => !c.passed).length;
  return (
    <Card className="mt-6">
      <CardHeader>
        <div>
          <CardTitle>Reconciliation</CardTitle>
          <p className="mt-1 text-xs text-muted">
            {status === "NOT_RUN" ? "Not run: the file failed validation before reconciliation." : `${checks.length - failed} of ${checks.length} checks passed against the control totals.`}
          </p>
        </div>
        {checks.length ? (
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Only failed checks
          </label>
        ) : null}
      </CardHeader>
      <CardBody className="overflow-x-auto px-0">
        {rows.length === 0 ? (
          <p className="px-5 text-sm text-muted">{checks.length ? "No failed checks." : "No reconciliation checks recorded."}</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Reconciliation checks: expected control totals versus imported totals</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="px-5 py-2 font-medium">Month</th>
                <th scope="col" className="px-5 py-2 font-medium">Check</th>
                <th scope="col" className="px-5 py-2 text-right font-medium">Expected</th>
                <th scope="col" className="px-5 py-2 text-right font-medium">Actual</th>
                <th scope="col" className="px-5 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((c) => (
                <tr key={`${c.month}-${c.metric}-${c.currency ?? c.unit}`} className="border-b border-border/70 last:border-0">
                  <td className="px-5 py-2">{formatMonth(c.month)}</td>
                  <td className="px-5 py-2">{METRIC[c.metric]} <span className="text-muted">({c.currency ?? c.unit})</span></td>
                  <td className="px-5 py-2 text-right">{c.expected}</td>
                  <td className="px-5 py-2 text-right">{c.actual}</td>
                  <td className="px-5 py-2">
                    {c.passed ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-4" aria-hidden /> Passed</span>
                      : <span className="inline-flex items-center gap-1 text-danger"><XCircle className="size-4" aria-hidden /> Failed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

type SortKey = "line" | "severity" | "code";
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

function IssuesTable({ issues }: { issues: ImportIssue[] }) {
  const [severity, setSeverity] = useState<"all" | ImportIssue["severity"]>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "line", dir: 1 });
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = issues.filter((i) => (severity === "all" || i.severity === severity) && (!q || `${i.code} ${i.message} ${i.field ?? ""}`.toLowerCase().includes(q)));
    const val = (i: ImportIssue) => (sort.key === "line" ? (i.line ?? 0) : sort.key === "severity" ? SEVERITY_RANK[i.severity] : i.code);
    return out.sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0));
  }, [issues, severity, query, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / ISSUE_PAGE));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * ISSUE_PAGE, (current + 1) * ISSUE_PAGE);

  const header = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="px-5 py-2 font-medium">
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-text">
        {label} <ArrowDownUp className="size-3" aria-hidden />
      </button>
    </th>
  );

  return (
    <Card className="mt-6">
      <CardHeader>
        <div>
          <CardTitle>Validation issues</CardTitle>
          <p className="mt-1 text-xs text-muted">{formatInteger(issues.length)} recorded (the API stores at most 500 per batch).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="issue-search">Search issues</label>
          <Input id="issue-search" type="search" placeholder="Search code or message" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} className="h-9 w-56" />
          <label className="sr-only" htmlFor="issue-severity">Severity</label>
          <Select id="issue-severity" value={severity} onChange={(e) => { setSeverity(e.target.value as typeof severity); setPage(0); }} className="h-9 w-auto">
            <option value="all">All severities</option>
            <option value="error">Errors</option>
            <option value="warning">Warnings</option>
            <option value="info">Info</option>
          </Select>
        </div>
      </CardHeader>
      <CardBody className="overflow-x-auto px-0">
        {visible.length === 0 ? (
          <p className="px-5 text-sm text-muted">{issues.length ? "No issues match the filters." : "No issues were reported for this batch."}</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Validation issues reported for this batch</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                {header("line", "Line")}
                {header("severity", "Severity")}
                {header("code", "Code")}
                <th scope="col" className="px-5 py-2 font-medium uppercase tracking-wider">Message</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i, idx) => (
                <tr key={`${i.line}-${i.code}-${idx}`} className="border-b border-border/70 align-top last:border-0">
                  <td className="tabular px-5 py-2 text-muted">{i.line ?? "file"}</td>
                  <td className="px-5 py-2"><Badge tone={i.severity === "error" ? "danger" : i.severity === "warning" ? "warning" : "neutral"}>{i.severity}</Badge></td>
                  <td className="px-5 py-2 font-mono text-xs">{i.code}{i.field ? <span className="block text-muted">{i.field}</span> : null}</td>
                  <td className="px-5 py-2 text-text">{i.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pageCount > 1 ? (
          <nav aria-label="Issue pages" className="flex items-center justify-between px-5 pt-4 text-sm">
            <span className="tabular text-muted">Page {current + 1} of {pageCount} · {formatInteger(filtered.length)} issues</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>Next</Button>
            </div>
          </nav>
        ) : null}
      </CardBody>
    </Card>
  );
}
